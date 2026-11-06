import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { asyncHandler } from '../middleware/errors.js';
import { deleteFirebaseUser } from '../middleware/auth.js';

const router = Router();

// DELETE /account (Apple App Store Account Deletion requirement)
// Permanently deletes the user and all associated data:
// 1. Deletes all uploaded files on disk (uploads/<uid>/)
// 2. Deletes the user in SQLite; foreign key CASCADE automatically deletes:
//    - documents
//    - chunks
//    - conversations
//    - messages
//    - question_log
// 3. Deletes the Firebase Auth user
router.delete('/', asyncHandler(async (req, res) => {
  const uid = req.user.uid;

  // 1. Delete upload files from disk
  const userUploadDir = path.join(config.uploadDir, uid);
  try {
    fs.rmSync(userUploadDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to clean up uploads directory for user ${uid}:`, err.message);
  }

  // 2. Delete user from database (triggers foreign key CASCADE on all user data)
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);

  // 3. Delete from Firebase Auth if real auth is enabled
  await deleteFirebaseUser(uid);

  res.status(204).end();
}));

export default router;
