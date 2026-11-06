import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

const router = Router();
const idParam = (req) => z.coerce.number().int().positive().parse(req.params.id);

// GET /chunks/:id (Source Viewer)
// Fetch a chunk along with its parent document info.
// Strict ownership check: only returns the chunk if its parent document belongs to req.user.uid.
router.get('/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);

  const row = db.prepare(`
    SELECT
      c.id,
      c.document_id,
      c.chunk_index,
      c.page,
      c.text,
      d.title AS document_title,
      d.original_name,
      d.folder
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.id = ? AND d.user_id = ?
  `).get(id, req.user.uid);

  if (!row) {
    throw new HttpError(404, 'Chunk not found', 'not_found');
  }

  res.json({
    id: row.id,
    documentId: row.document_id,
    title: row.document_title,
    documentTitle: row.document_title,
    originalName: row.original_name,
    folder: row.folder,
    chunkIndex: row.chunk_index,
    page: row.page,
    text: row.text,
  });
}));

export default router;

