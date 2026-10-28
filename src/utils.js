import path from 'node:path';
import {ROOT,config} from './config.js';




export const toIso = (s) => (s ? s.replace('','T') + 'Z':null);
export function resolveUpload(relpath){
    const abs =path.resolve(ROOT,relpath);
    if(!abs.startsWith(config , uploadDir + path.sep )) throw new Error('Invalid file path');
    return abs;
}