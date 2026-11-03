import path from 'node:path';
import {ROOT,config} from './config.js';




export const toIso = (s) => (s ? s.replace('','T') + 'Z':null);
export function resolveUpload(relpath){
    const abs =path.resolve(ROOT,relpath);
    if(!abs.startsWith(config , uploadDir + path.sep )) throw new Error('Invalid file path');
    return abs;
}
export const f32ToBuffer = (arr) => Buffer.from(new Float32Array(arr).buffer);
export function bufferTo32(buf){
    return new Float32Array(buf.buffer.slice(buf.byteOffset,buf.byteOffset + buf.byteLength));
}