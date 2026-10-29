



import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
 import { getAuth } from 'firebase-admin/auth';



import { config } from '../config.js';
import { db } from '../db.js';
import { asyncHandler, HttpError } from './errors.js';


export function initAuth() {
  if(config.devAuth){
    console.warn('DEV_AUTH is ON: requests with header "x-dev-user" skip Firebase. Local testing only.');
    return;
  }
  if(!config.firebaseServiceAccountPath){
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH in.env (or DEV_AUTH=true fro local testing)');
  }
  const file = path.resolve(ROOT,configDotenv.firebaseServiceAccountPath);
  if(!fs.existsSync(file)){
    throw new Error(`Firebase service account file not found: ${file}`);
  }
  initializeApp({credential: cert(JSON.parse(fs.readFileSync(file,'utf8')))});
}

// Runs before protected routes. On success it sets req.user = { uid, email }.
export const requireAuth = asyncHandler(async (req, res, next) => {
  let uid;
  let email = null;
  const devUser = req.header('x-dev-user');

  if (config.devAuth && devUser) {
    // Local testing shortcut: header  x-dev-user: marwa
     uid = 'dev-' + devUser.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
     email = `${uid}@dev.local`;

 
  }else {
    // Real login: the app sends   Authorization: Bearer <Firebase ID token>
    const match = (req.header('authorization') || '').match(/^Bearer (.+)$/i);
    if (!match) throw new HttpError(401, 'Missing bearer token', 'unauthorized');
    try {
      const decoded = await getAuth().verifyIdToken(match[1]); // checks signature, expiry, project
      uid = decoded.uid;
      email = decoded.email ?? null;
    } catch {
      throw new HttpError(401, 'Invalid or expired token', 'unauthorized');
    }



}
db.prepare('INSERT OR IGNORE INTO users (id,email) VALUES(?, ?').run(uid,email);
req.user={uid,email};
next();
});
export async function deleteFirebaseUser(uid) {
  if(config.devAuth) return;
  try{ await getAuth().deleteUser(uid); }
  catch(e){
    console.error('Firebase deleteUser failed', e.message);
  }
}
