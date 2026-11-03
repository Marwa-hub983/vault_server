

import { db } from '../db.js';
import { resolveUpload, f32ToBuffer } from '../utils.js';
import { extractPages } from './extract.js';
import { chunkPages } from './chunk.js';
import { embedTexts } from './embed.js';


class ReadableError extends Error {}

const queue =[];
let running = false;

export function enqueue(docId){
    queue.push(docId);
    void running();
}

async function run(){
    if(running)return;
    running=true;
    while(queue.length){
        const id =queue.shift();
        try{
            await ingestDocument(id);
        }catch(e){
            console.error('ingest crashed',id,e);
        }
    }
    running =false;
}
export function requeueStale() {
  const rows = db.prepare("SELECT id FROM documents WHERE status IN ('uploaded','processing')").all();
  rows.forEach((r) => enqueue(r.id));
  if (rows.length) console.log(`Re-queued ${rows.length} unfinished document(s)`);
}

const setStatus = (id, status, error = null) =>
  db.prepare("UPDATE documents SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, error, id);

const exists = (id) => !!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id);

// ---------- The pipeline: extract -> chunk -> embed -> save ----------
async function ingestDocument(id) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) return; // deleted while waiting in the queue

  try {
    setStatus(id, 'processing');

    // 1. extract text
    const pages = await extractPages(resolveUpload(doc.file_path), doc.original_name);
    const totalChars = pages.reduce((n, p) => n + p.text.trim().length, 0);
    if (totalChars < 20) throw new ReadableError('No readable text found (is it a scanned PDF?)');

    // 2. chunk
    const chunks = chunkPages(pages);

    // 3. embed (slow part)
    const vectors = await embedTexts(chunks.map((c) => c.text));

    // The user may have deleted the document while we were embedding
    if (!exists(id)) return;

    // 4. save everything together: all chunks + status 'ready', or nothing
    const insert = db.prepare(
      'INSERT INTO chunks (document_id, chunk_index, page, text, embedding) VALUES (?, ?, ?, ?, ?)'
    );
    db.transaction(() => {
      db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id); // makes reindex safe
      chunks.forEach((c, i) => insert.run(id, c.index, c.page, c.text, f32ToBuffer(vectors[i])));
      db.prepare(
        "UPDATE documents SET status = 'ready', error = NULL, page_count = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(pages.length, id);
    })();
  } catch (e) {
    // Log the real error for you; show the user a safe message (no server file paths).
    console.error(`Document ${id} failed:`, e.message);
    if (exists(id)) {
      setStatus(id, 'failed', e instanceof ReadableError
        ? e.message
        : 'Could not process this file. It may be damaged or password-protected.');
    }
  }
}