import { config } from '../config.js';
import { db } from '../db.js';
import { asyncHandler, HttpError } from './errors.js';

// Runs before protected routes. On success it sets req.user = { uid, email }.
export const requireAuth = asyncHandler(async (req, res, next) => {
  const devUser = req.header('x-dev-user');

  if (config.devAuth && devUser) {
    // Local testing shortcut: header  x-dev-user: marwa
    const uid = 'dev-' + devUser.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const email = `${uid}@dev.local`;

    // Create the user row the first time we see this user
    db.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').run(uid, email);

    req.user = { uid, email };
    return next();
  }

  // TODO Step 9: verify a real Firebase ID token here.
  throw new HttpError(401, 'Missing or invalid credentials', 'unauthorized');
});