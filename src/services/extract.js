import fs from 'node:fs/promises';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

export async function extractPages(absPath, orginalName){
    const ext= path.extname(orginalName).toLowerCase()
;

if(ext === '.txt' || ext === '.md'){
    const text =await fs.readFile(absPath, 'utf8');
    return [{page: null,text}];
}
if(ext === '.pdf'){
    const buffer =await fs.readFile(absPath);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } =await extractText(pdf,{ mergePages: false});
    return text.map((t,i)=> ({page: i+1,text :t}));
    
}
throw new Error(`Unsupported file type: ${ext}`);
}