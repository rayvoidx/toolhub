import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),native=process.argv[2]==='native',outDir=resolve(root,native?'www':'../../workspace');
await build({root,base:native?'./':'/workspace/',build:{outDir,emptyOutDir:true,target:'es2022'}});
if(!native){
 const files=[];async function walk(dir){for(const d of await readdir(dir,{withFileTypes:true})){const f=resolve(dir,d.name);if(d.isDirectory())await walk(f);else files.push(relative(outDir,f));}}await walk(outDir);
 const hash=createHash('sha256');for(const f of files)hash.update(await readFile(resolve(outDir,f)));const revision=hash.digest('hex').slice(0,12);
 const sw=`const CACHE='pocket-${revision}';const FILES=${JSON.stringify(['./',...files.map(f=>'./'+f)])};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pocket-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith('/workspace/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('./')));return;}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`;
 await writeFile(resolve(outDir,'sw.js'),sw);
}
const html=await readFile(resolve(outDir,'index.html'),'utf8');if(/<iframe|googlesyndication|googletagmanager|server\.url/.test(html))throw Error('Unexpected remote shell or tracking script');
console.log(native?'Bundled native assets ready (no server.url)':'Installable workspace built: /workspace/');
