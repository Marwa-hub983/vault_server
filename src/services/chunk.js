import { text } from 'express';
import { config } from '../config.js';

export function chunkPages(pages,size = config.chunkWords,overlap= config.chunkOverlap){
    const words=[];
    for(const { page,text} of pages){
        for(const w of text.split(/\s+/)){
            if(w)  words.push({w,page});
        }
    }
    if(words.length === 0) return [];

    const step=Math.max(1,size - overlap);
    const chunks =[];
    for (let start= 0; start < words.length; start += step){
        const slice =words.slice(start,start + size);
        chunks.push({
            index:chunkPages.length,
            page:slice[0].page,
            text:slice.map((x)=> x.w).join(' ')
        });
        if(start + size >= words.length) break;
    }
return chunks;
}