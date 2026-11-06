import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config, ROOT } from '../config.js';
import { db } from '../db.js';
import { asyncHandler, HttpError } from './errors.js';

/**
 * Initializes the Firebase Admin SDK.
 *
 * - In production: FIREBASE_SERVICE_ACCOUNT_PATH must be valid; DEV_AUTH must be false.
 * - In development: If the service account file exists, Firebase is initialized so
 *   both real Firebase ID tokens and `x-dev-user` shortcut headers are supported.
 */
export function initAuth() {
  if (config.firebaseServiceAccountPath) {
    const file = path.resolve(ROOT, config.firebaseServiceAccountPath);
    if (fs.existsSync(file)) {
      if (getApps().length === 0) {
        initializeApp({ credential: cert(JSON.parse(fs.readFileSync(file, 'utf8'))) });
        console.log('Firebase Admin SDK initialized successfully.');
      }
    } else if (!config.devAuth) {
      throw new Error(`Firebase service account file not found: ${file}`);
    }
  } else if (!config.devAuth) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH in .env (or DEV_AUTH=true for local testing)');
  }

  if (config.devAuth) {
    console.warn('DEV_AUTH is ON: requests with header "x-dev-user" skip Firebase. Local testing only.');
  }
}

/**
 * Middleware running before protected routes.
 *
 * Authenticates via:
 * 1. `x-dev-user: <name>` (if DEV_AUTH=true)
 * 2. `Authorization: Bearer <Firebase ID Token>` (verified via Firebase Admin)
 *
 * Sets `req.user = { uid, email }` on success and ensures the user row exists in SQLite.
 */
export const requireAuth = asyncHandler(async (req, res, next) => {
  let uid;
  let email = null;
  const devUser = req.header('x-dev-user');

  if (config.devAuth && devUser) {
    // Local testing shortcut: header x-dev-user: marwa
    uid = 'dev-' + devUser.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    email = `${uid}@dev.local`;
  } else {
    // Real authentication: Authorization: Bearer <Firebase ID token>
    const match = (req.header('authorization') || '').match(/^Bearer (.+)$/i);
    if (!match) throw new HttpError(401, 'Missing bearer token', 'unauthorized');

    if (getApps().length === 0) {
      throw new HttpError(
        500,
        'Firebase Admin SDK is not initialized. Check FIREBASE_SERVICE_ACCOUNT_PATH in .env.',
        'firebase_not_initialized'
      );
    }

    try {
      const decoded = await getAuth().verifyIdToken(match[1]); // verifies signature, expiry, audience, project
      uid = decoded.uid;
      email = decoded.email ?? null;
    } catch (err) {
      if (config.nodeEnv !== 'production') {
        console.warn('Firebase ID token verification failed:', err.message);
      }
      throw new HttpError(401, 'Invalid or expired token', 'unauthorized');
    }
  }

  // Ensure user exists in local SQLite database
  db.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').run(uid, email);

  req.user = { uid, email };
  next();
});

/**
 * Deletes the user from Firebase Authentication if real auth is used.
 * Skips for dev users (`dev-...`) or if Firebase is not initialized.
 */
export async function deleteFirebaseUser(uid) {
  if (!uid || uid.startsWith('dev-')) return;
  if (getApps().length === 0) return;

  try {
    await getAuth().deleteUser(uid);
    console.log(`Deleted Firebase user: ${uid}`);
  } catch (err) {
    console.error('Firebase deleteUser failed:', err.message);
  }
}
