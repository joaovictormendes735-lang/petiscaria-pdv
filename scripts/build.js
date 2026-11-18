import { build } from 'esbuild';
import { mkdir,copyFile,readFile,writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
await mkdir('dist',{ recursive:true });
await build({ entryPoints:['public/app.js','public/v2.js','public/v3.js','public/sw.js','public/style.css'],outdir:'dist',minify:true,target:['es2020'],legalComments:'none' });
await copyFile('public/favicon.svg','dist/favicon.svg');
for(const file of ['manifest.webmanifest','icon192.png','icon512.png','offline.html'])await copyFile('public/'+file,'dist/'+file);
await writeFile('dist/index.html',(await readFile('public/index.html','utf8')).replace(/>\s+</g,'><').trim());
let bytes=0;
for (const file of ['index.html','app.js','v2.js','v3.js','sw.js','style.css','favicon.svg','manifest.webmanifest','icon192.png','icon512.png','offline.html']) { const n=gzipSync(await readFile(`dist/${file}`)).length; bytes+=n; console.log(`${file}: ${n} bytes gzip`); }
console.log(`Interface inicial: ${(bytes/1024).toFixed(1)} KB gzip / meta 150 KB`);
if (bytes>150*1024) throw Error('Interface ultrapassou o orçamento de desempenho.');
