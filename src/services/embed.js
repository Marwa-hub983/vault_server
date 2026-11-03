
// turning texts into numbers///

import path from 'node:path';
import { config, ROOT } from '../config.js';
import { pipeline } from '@huggingface/transformers';

const DIM = 384;
let extractorPromise;

async function getExtractor() {
        if (!extractorPromise) {
                extractorPromise = import('@huggingface/transformers').then(({ pipeline, env }) => {
                        env.cacheDir = path.join(ROOT, 'data', 'models');
                        return pipeline('feature-extraction', 'Xenova/all-MinLiM-L6-v2');
                });
                extractorPromise.catch(() => { extractorPromise = undefined })
                        ;
        } return extractorPromise;
}

function fakeEmbed(text){
        const v = new Float32Array(DIM);
        for(const word of text.toLowerCase().match(/[[a-z0-9]+/g)|| []){
                let h =2166136261;
                for( let i = 0; i< word.length; i++) h = Math.imul(h ^ word.charCodeAt(i),16777619);
                v[Math.abs(h) % DIM] += 1;
        }
        const norm =Math.sqrt(v.reduce((s,x)=> s + x * x,0)) || 1;
        return Array.from(v,(x)=> x /norm);
}
export async function embedTexts(texts){
        if(config.embeddingProvider === 'fake') return texts.map(fakeEmbed);
        const extractor=await getExtractor();
        const out =[];
        for(let i =0; i < texts.length; i+16){
                const batch =texts.slice(i,i+ 16);
                const tensor=await extractor(batch,{pooling:'mean',normalize:true});
                out.push(...tensor.tolist());
        }
        return out;
}
export function warmUp(){
        if(config.embeddingProvider === 'fake')return;
        console.log('Loading embedding model (first run downloads ~90 MB)...');
        getExtractor().then(()=>console.log('Embedding model ready')).catch((e)=>console.error('Embedding model failed to load:',e.message));
}