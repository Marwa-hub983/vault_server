import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root folder (one level above /src)
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v) => String(v).toLowerCase() === 'true';

export const config = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  devAuth: bool(process.env.DEV_AUTH),
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/vault.db'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'uploads'),
    maxUploadMb: num(process.env.MAX_UPLOAD_MB, 20),
      chunkWords: num(process.env.CHUNK_WORDS, 180),
  chunkOverlap: num(process.env.CHUNK_OVERLAP, 30),
};

// Safety: never allow the dev shortcut in production
if (config.nodeEnv === 'production' && config.devAuth) {
  throw new Error('DEV_AUTH must be false in production');
}