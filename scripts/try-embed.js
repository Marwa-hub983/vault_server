import { embedTexts } from '../src/services/embed.js';


const sentences =[
      'Cubit is a simpler version of BLoC',
  'BLoC uses events and states',
  'My favourite food is biryani',
];
console.log('Loading model (first run downloads ~90 MB)...');
const vectors= await embedTexts(sentences);

console.log(`\nVectors: ${vectors.length} | numbers per vector: ${vectors[0].length}`);
console.log('First 5 numbers of vector 0:',vectors[0].slice(0,5).map((n)=> n.toFixed(3)).join(','));

const dot =(a,b)=> a.reduce((sum,x,i)=> sum + x* b[i],0);
console.log('\nSimilarity (1.0 = same meaning, near 0 = unrelated):');
for (let i = 0; i < sentences.length; i++) {
  for (let j = i + 1; j < sentences.length; j++) {
    console.log(`  "${sentences[i]}"  vs  "${sentences[j]}"  =>  ${dot(vectors[i], vectors[j]).toFixed(3)}`);
  }
}