import {Router} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import{ db } from '../db.js';
import { asyncHandler } from '../middleware/errors.js';
import { deleteFirebaseUser } from '../middleware/auth.js';

const router = Router();

 router.delete('/', asyncHandler(async(req,res)=>{
    const uid = req.user.uid;
    fs.rmSync(path.join(config.uploadDir,uid),{recursive:true,force:true});
    db.prepare('DELETE FROM users WHERE id= ?').run(uid);
    await deleteFirebaseUser(uid);
    res.status(204).end();
 }));
 export default router;