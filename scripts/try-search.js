// Usage:
//   npm run search -- "your question"
//   npm run search -- "your question" --folder Flutter
//   npm run search -- "your question" --doc 3
//   npm run search -- "your question" --user dev-marwa --k 3 --min 0.1
import { config } from '../src/config.js';
import { embedTexts } from '../src/services/embed.js';
import { retrieve } from '../src/services/retrieve.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const question = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

if (!question) {
  console.log('Usage: npm run search -- "your question" [--folder NAME] [--doc ID] [--user UID] [--k N] [--min SCORE]');
  process.exit(1);
}

const userId = flag('user') || 'dev-marwa';
const k = Number(flag('k') || config.topK);
const min = Number(flag('min') ?? config.minScore);
const scope = flag('doc') ? { type: 'document', value: flag('doc') }
  : flag('folder') ? { type: 'folder', value: flag('folder') }
  : { type: 'all' };

console.log(`Question: "${question}"`);
console.log(`User: ${userId} | scope: ${scope.type}${scope.value ? ' = ' + scope.value : ''} | top ${k} | min score ${min}\n`);

const [queryVec] = await embedTexts([question]);
const t0 = performance.now();
const hits = retrieve(userId, queryVec, scope, k, min);
const ms = (performance.now() - t0).toFixed(1);

if (hits.length === 0) {
  console.log(`No chunk scored above ${min}. (This is when the app answers "Not found in your documents.")`);
} else {
  hits.forEach((h, i) => {
    console.log(`#${i + 1}  score ${h.score.toFixed(3)}  |  ${h.title}${h.page ? ', p.' + h.page : ''}  (chunk ${h.id})`);
    console.log(`    ${h.text.slice(0, 110).replace(/\s+/g, ' ')}...\n`);
  });
}
console.log(`Searched in ${ms} ms`);