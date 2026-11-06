import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { embedTexts } from '../services/embed.js';
import { retrieve } from '../services/retrieve.js';
import { createLlmStream } from '../services/llm.js';

const router = Router();

// Validation schema for /ask
const askSchema = z.object({
  question: z.string().trim().min(1, 'Question cannot be empty').max(2000),
  conversationId: z.coerce.number().int().positive().optional(),
  scope: z.object({
    type: z.enum(['all', 'folder', 'document']).default('all'),
    value: z.union([z.string(), z.number()]).optional(),
  }).default({ type: 'all' }),
});

// SSE format helper
function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// System prompt enforcing strict citation and faithfulness to context
const SYSTEM_PROMPT = `You are a helpful assistant for answering questions based ONLY on the provided context documents.

Strict Rules:
1. Answer the question using ONLY the facts directly stated in the context below. Do not use outside knowledge or assumptions.
2. If the context does not contain enough information to answer the question, respond with: "Not found in your documents."
3. Every factual claim in your answer MUST cite the source chunk using [1], [2], etc., matching the numbered context sections.
4. Keep your answer clear, concise, and truthful to the context.`;

// Save the completed conversation turn to the database
function saveTurn(conversationId, question, answer, citations) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO messages (conversation_id, role, content, citations_json)
      VALUES (?, 'user', ?, NULL)
    `).run(conversationId, question);

    db.prepare(`
      INSERT INTO messages (conversation_id, role, content, citations_json)
      VALUES (?, 'assistant', ?, ?)
    `).run(
      conversationId,
      answer,
      citations && citations.length > 0 ? JSON.stringify(citations) : null
    );

    db.prepare(`
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(conversationId);
  })();
}

// POST /ask (RAG + SSE streaming)
router.post('/', asyncHandler(async (req, res) => {
  const body = askSchema.parse(req.body);
  const userId = req.user.uid;

  // 1. Check daily question limit
  const todayCount = db.prepare(`
    SELECT COUNT(*) AS count FROM question_log
    WHERE user_id = ? AND created_at >= datetime('now', 'start of day')
  `).get(userId)?.count || 0;

  if (todayCount >= config.dailyQuestionLimit) {
    throw new HttpError(
      429,
      `Daily question limit reached (${config.dailyQuestionLimit}/day). Try again tomorrow.`,
      'daily_limit_reached'
    );
  }

  // 2. Validate or create conversation
  let conversationId = body.conversationId;
  if (conversationId) {
    const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
    if (!conv) {
      throw new HttpError(404, 'Conversation not found', 'not_found');
    }
  } else {
    const title = body.question.length > 50 ? body.question.slice(0, 47) + '...' : body.question;
    const info = db.prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)').run(userId, title);
    conversationId = Number(info.lastInsertRowid);
  }

  // Log question attempt
  db.prepare('INSERT INTO question_log (user_id) VALUES (?)').run(userId);

  // 3. Embed question and retrieve relevant chunks
  const [queryVec] = await embedTexts([body.question]);
  const hits = retrieve(userId, queryVec, body.scope, config.topK, config.minScore);

  const citations = hits.map((h, i) => ({
    index: i + 1,
    chunkId: h.id,
    documentId: h.document_id,
    title: h.title,
    page: h.page,
    text: h.text,
    score: Number(h.score.toFixed(4)),
  }));

  // 4. If no chunk scored above minScore, return "Not found" without calling LLM
  if (hits.length === 0) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sendSse(res, 'meta', { conversationId, citations: [] });
    const notFound = 'Not found in your documents.';
    sendSse(res, 'delta', { text: notFound });

    saveTurn(conversationId, body.question, notFound, []);

    sendSse(res, 'done', { text: notFound });
    return res.end();
  }

  // 5. Build prompt with context chunks and conversation history
  const contextBlocks = hits.map((h, i) => {
    const pageStr = h.page ? ` (Page ${h.page})` : '';
    return `[${i + 1}] Document: "${h.title}"${pageStr}\n${h.text}`;
  }).join('\n\n');

  const history = db.prepare(`
    SELECT role, content FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
    LIMIT 10
  `).all(conversationId);

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `Context:\n${contextBlocks}\n\nQuestion: ${body.question}`,
    },
  ];

  // 6. Connect to LLM before writing SSE headers so connection errors (e.g. 503) can be JSON
  const stream = await createLlmStream({ system: SYSTEM_PROMPT, messages });

  // 7. Start SSE streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sendSse(res, 'meta', { conversationId, citations });

  let fullAnswer = '';

  try {
    for await (const chunk of stream) {
      fullAnswer += chunk;
      sendSse(res, 'delta', { text: chunk });
    }

    // Save only when complete
    saveTurn(conversationId, body.question, fullAnswer, citations);

    sendSse(res, 'done', { text: fullAnswer });
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      sendSse(res, 'error', {
        code: err.code || 'stream_error',
        message: err.message || 'Stream interrupted',
      });
      res.end();
    }
  }
}));

export default router;

