import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validatePack} from '../versions/0.3.2/core.mjs';
import {mergeChapter} from '../versions/0.3.2/assets/chapter-library.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),v=path.join(root,'versions/0.3.2');
const read=f=>JSON.parse(fs.readFileSync(f));
const images=read(path.join(root,'asset-checksums.json')).images;
assert.equal(images.length,172);
for(const image of images){const file=fs.readFileSync(path.join(root,image.file));assert.equal(file.length,image.bytes);assert.equal(crypto.createHash('sha256').update(file).digest('hex'),image.sha256,image.file);assert.equal(file.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
const pack=validatePack(mergeChapter(read(path.join(v,'pack.json')),read(path.join(v,'assets/chapter09/library.json')),read(path.join(v,'assets/background-library.json'))).pack);
for(const f of [...Object.values(pack.backgrounds),...Object.values(pack.illustrations),...Object.values(pack.characters).flatMap(c=>Object.values(c.variants))])assert(fs.existsSync(path.join(root,f)),f);
const forbidden=/^(?:state|private|backups|evidence|node_modules|\.env)(?:$|\.)/i;
let files=0;
function scan(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){if(d.name==='.git')continue;assert(!forbidden.test(d.name),'Private/development path: '+d.name);const p=path.join(dir,d.name);if(d.isDirectory())scan(p);else{files++;if(/\.(mjs|json|html|css|md)$/.test(d.name)){const text=fs.readFileSync(p,'utf8');assert(!/[A-Z]:[\\/](?:Users|桌面|Documents|下载)/i.test(text),'Private absolute path in '+path.relative(root,p));if(p.startsWith(v))assert(!/127\.0\.0\.1:8787|gemini-4-argon|\/api\/reserve/.test(text),'Developer transport in runtime');}}}}
scan(root);
const loader=read(path.join(root,'install/风暴瞭望-0.3.2.json'));assert.equal(loader.enabled,false);assert(loader.content.includes('/versions/0.3.2/app.mjs'));assert.deepEqual(loader.data,{});
console.log(JSON.stringify({files,pngs:images.length,bytes:images.reduce((n,x)=>n+x.bytes,0),chapterAssets:pack.chapterRegistry.length,passed:true}));
