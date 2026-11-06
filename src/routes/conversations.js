import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { toIso } from '../utils.js';

const router = Router();
const idParam = (req) => z.coerce.number().int().positive().parse(req.params.id);

// Verify conversation ownership; throws 404 if not found or belongs to another user
function getOwnedConversation(id, userId) {
  const conv = db.prepare(`
    SELECT id, title, created_at, updated_at
    FROM conversations
    WHERE id = ? AND user_id = ?
  `).get(id, userId);

  if (!conv) {
    throw new HttpError(404, 'Conversation not found', 'not_found');
  }
  return conv;
}

// GET /conversations?limit=&offset=
// List user's conversations with message counts and timestamps
router.get('/', asyncHandler(async (req, res) => {
  const q = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);

  const rows = db.prepare(`
    SELECT
      c.id,
      c.title,
      c.created_at,
      c.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message
    FROM conversations c
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `).all(req.user.uid, q.limit, q.offset);

  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    messageCount: r.message_count,
    lastMessage: r.last_message || null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  }));

  res.json({ items, limit: q.limit, offset: q.offset });
}));

// GET /conversations/:id/messages
// Fetch all messages in a conversation
router.get('/:id/messages', asyncHandler(async (req, res) => {
  const convId = idParam(req);
  getOwnedConversation(convId, req.user.uid); // ownership check

  const rows = db.prepare(`
    SELECT id, conversation_id, role, content, citations_json, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `).all(convId);

  const items = rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    citations: r.citations_json ? JSON.parse(r.citations_json) : [],
    createdAt: toIso(r.created_at),
  }));

  res.json({ items });
}));

// DELETE /conversations/:id
// Delete a conversation. Associated messages are cascade-deleted automatically by SQLite.
router.delete('/:id', asyncHandler(async (req, res) => {
  const convId = idParam(req);
  getOwnedConversation(convId, req.user.uid); // ownership check

  db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
  res.status(204).end();
}));

export default router;

