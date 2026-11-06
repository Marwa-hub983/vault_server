// Usage:
//   npm run ask -- "what is cubit"
//   npm run ask -- "what is cubit" --folder Flutter
//   npm run ask -- "what is cubit" --doc 1
//   npm run ask -- "what is cubit" --user dev-marwa
import { config } from '../src/config.js';
import { embedTexts } from '../src/services/embed.js';
import { retrieve } from '../src/services/retrieve.js';
import { createLlmStream } from '../src/services/llm.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const question = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

if (!question) {
  console.log('Usage: npm run ask -- "your question" [--folder NAME] [--doc ID] [--user UID]');
  process.exit(1);
}

const userId = flag('user') || 'dev-marwa';
const scope = flag('doc')
  ? { type: 'document', value: flag('doc') }
  : flag('folder')
  ? { type: 'folder', value: flag('folder') }
  : { type: 'all' };

console.log(`\nQuestion: "${question}"`);
console.log(`User: ${userId} | LLM Provider: ${config.llmProvider} | Model: ${config.llmProvider === 'anthropic' ? config.anthropicModel : config.ollamaModel}`);
console.log(`----------------------------------------------------------------`);

const [queryVec] = await embedTexts([question]);
const hits = retrieve(userId, queryVec, scope, config.topK, config.minScore);

if (hits.length === 0) {
  console.log('\n[Event: meta] citations: []');
  console.log('\nAnswer:\nNot found in your documents.');
  process.exit(0);
}

console.log(`\n[Event: meta] ${hits.length} citation(s) found:`);
hits.forEach((h, i) => {
  console.log(`  [${i + 1}] "${h.title}"${h.page ? ' (p. ' + h.page + ')' : ''} (score: ${h.score.toFixed(3)})`);
});

const systemPrompt = `You are a helpful assistant for answering questions based ONLY on the provided context documents.

Strict Rules:
1. Answer the question using ONLY the facts directly stated in the context below. Do not use outside knowledge or assumptions.
2. If the context does not contain enough information to answer the question, respond with: "Not found in your documents."
3. Every factual claim in your answer MUST cite the source chunk using [1], [2], etc., matching the numbered context sections.
4. Keep your answer clear, concise, and truthful to the context.`;

const contextText = hits.map((h, i) => {
  const pageStr = h.page ? ` (Page ${h.page})` : '';
  return `[${i + 1}] Document: "${h.title}"${pageStr}\n${h.text}`;
}).join('\n\n');

const messages = [
  {
    role: 'user',
    content: `Context:\n${contextText}\n\nQuestion: ${question}`,
  },
];

console.log('\nStreaming answer...');
console.log('----------------------------------------------------------------');

try {
  const stream = await createLlmStream({ system: systemPrompt, messages });
  for await (const delta of stream) {
    process.stdout.write(delta);
  }
  console.log('\n----------------------------------------------------------------');
  console.log('[Event: done]');
} catch (err) {
  console.error(`\nError: [${err.code || 'error'}] ${err.message}`);
  process.exit(1);
}

