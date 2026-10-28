import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { resolveUpload, toIso } from '../utils.js';

const router = Router();
const ALLOWED = new Set(['.pdf', '.txt', '.md']);

// ---------- File upload settings (multer) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.uploadDir, req.user.uid); // one folder per user
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // Never trust the client's file name on disk: use a random name.
    filename: (req, file, cb) =>
      cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED.has(ext)) return cb(null, true);
    cb(new HttpError(400, 'Only PDF, TXT and MD files are supported', 'unsupported_type'));
  },
});

// ---------- Helpers ----------
// DB row (snake_case) -> JSON for the app (camelCase)
const toDoc = (r) => ({
  id: r.id,
  title: r.title,
  originalName: r.original_name,
  type: path.extname(r.original_name).slice(1).toLowerCase(),
  size: r.size,
  folder: r.folder,
  status: r.status,
  error: r.error,
  pageCount: r.page_count,
  chunkCount: r.chunk_count ?? undefined,
  createdAt: toIso(r.created_at),
  updatedAt: toIso(r.updated_at),
});

// Fetch a document ONLY if it belongs to this user. Otherwise 404.
function getOwned(id, userId) {
  const row = db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
    FROM documents d WHERE d.id = ? AND d.user_id = ?`).get(id, userId);
  if (!row) throw new HttpError(404, 'Document not found', 'not_found');
  return row;
}

const idParam = (req) => z.coerce.number().int().positive().parse(req.params.id);

// ---------- Routes ----------

// GET /documents?folder=&status=&q=&limit=&offset=
router.get('/', asyncHandler(async (req, res) => {
  const q = z.object({
    folder: z.string().optional(),
    status: z.enum(['uploaded', 'processing', 'ready', 'failed']).optional(),
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);

  let sql = 'SELECT * FROM documents WHERE user_id = ?';
  const params = [req.user.uid];
  if (q.folder) { sql += ' AND folder = ?'; params.push(q.folder); }
  if (q.status) { sql += ' AND status = ?'; params.push(q.status); }
  if (q.q) { sql += ' AND title LIKE ?'; params.push(`%${q.q}%`); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
  params.push(q.limit, q.offset);

  res.json({ items: db.prepare(sql).all(...params).map(toDoc), limit: q.limit, offset: q.offset });
}));

// GET /documents/folders  (must be BEFORE /:id, or "folders" is read as an id)
router.get('/folders', asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT folder AS name, COUNT(*) AS count FROM documents
    WHERE user_id = ? AND folder IS NOT NULL AND folder <> ''
    GROUP BY folder ORDER BY folder`).all(req.user.uid);
  res.json({ items: rows });
}));

// POST /documents   (multipart: file, title?, folder?)
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded (field name must be "file")', 'no_file');

  const body = z.object({
    title: z.string().trim().max(200).optional(),
    folder: z.string().trim().max(100).optional(),
  }).parse(req.body);

  const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); // fix non-English names
  const title = body.title || path.basename(original, path.extname(original));
  const rel = path.relative(ROOT, req.file.path).split(path.sep).join('/');      // store RELATIVE path

  const info = db.prepare(`
    INSERT INTO documents (user_id, title, original_name, file_path, mime, size, folder)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.uid, title, original, rel, req.file.mimetype, req.file.size, body.folder || null);

  // Step 5 will add here:  enqueue(info.lastInsertRowid);
  res.status(201).json(toDoc(getOwned(info.lastInsertRowid, req.user.uid)));
}));

// GET /documents/:id
router.get('/:id', asyncHandler(async (req, res) => {
  res.json(toDoc(getOwned(idParam(req), req.user.uid)));
}));

// GET /documents/:id/status   (the app polls this)
router.get('/:id/status', asyncHandler(async (req, res) => {
  const d = getOwned(idParam(req), req.user.uid);
  res.json({ id: d.id, status: d.status, error: d.error });
}));

// DELETE /documents/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const d = getOwned(idParam(req), req.user.uid);
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);      // chunks are deleted automatically (CASCADE)
  try { fs.unlinkSync(resolveUpload(d.file_path)); } catch { /* file already gone */ }
  res.status(204).end();
}));

export default router;