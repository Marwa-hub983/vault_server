import path from 'node:path';
import { extractPages } from   '../src/services/extract.js';
import { chunkPages } from    '../src/services/chunk.js';

const file =process.argv[2];
if(!file){
    console.log('Usage: node scripts/try-chunk.js <file.pdf|file.txt|file.md');
    process.exit(1);
}

const abs = path.resolve(file);
const pages= await extractPages(abs,path.basename(abs))
;
const chunks =chunkPages(pages);

const chars = pages.reduce((n,p)=> n + p.text.length,0);
console.log(`pages: ${pages.length}| Characters:${chars} | Chunks: ${chunks.length}\n`);


for (const c of chunks) {
  console.log(`#${c.index}  page=${c.page ?? '-'}  words=${c.text.split(' ').length}`);
  console.log(`   ${c.text.slice(0, 90)}...\n`);
}