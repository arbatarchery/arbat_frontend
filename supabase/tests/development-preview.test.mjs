import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {buildPreview} from '../scripts/preview-page.mjs';
const {namespaced,access}=createRequire(import.meta.url)('../../entrenamiento/js/sync-storage.js');
class Storage{data=new Map();get length(){return this.data.size;}key(i){return [...this.data.keys()][i]??null;}getItem(k){return this.data.get(k)??null;}setItem(k,v){this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}}
test('preview storage reads and clears only its own namespace',()=>{
 const storage=new Storage();storage.setItem('arbat-training-current','original');storage.setItem('arbat-training-history','original history');
 const preview=namespaced(storage,'preview:');preview.setItem('arbat-training-current','fake');preview.setItem('arbat-training-2026-11-01','fake older');
 assert.equal(preview.length,2);assert.equal(preview.getItem('arbat-training-current'),'fake');assert.equal(preview.getItem('arbat-training-history'),null);
 assert.ok([...Array(preview.length)].map((_,i)=>preview.key(i)).every(k=>!k.startsWith('preview:')));
 preview.clear();assert.equal(storage.getItem('arbat-training-current'),'original');assert.equal(storage.getItem('arbat-training-history'),'original history');
 assert.equal(namespaced(storage,''),storage);
});
test('blocked localStorage property is deferred to callers without crashing startup',()=>{
 const root={get localStorage(){throw new Error('SecurityError');}};const storage=access(root);assert.throws(()=>storage.getItem('key'),/SecurityError/);
});
test('development preview enables only its runtime and exposes only required assets',async()=>{
 const path=new URL('../../entrenamiento/config/supabase.public.json',import.meta.url),before=await readFile(path,'utf8');
 const preview=await buildPreview({cloudEnabled:true}),html=preview.pages.get('/entrenamiento/');
 assert.ok(html.includes('"enabled":true'));assert.ok(html.includes('"storagePrefix":"arbat-supabase-preview-v1:"'));assert.ok(html.includes('PRUEBA LOCAL SUPABASE'));
 assert.ok(!html.includes('sb_secret_'));assert.ok(!preview.assets.has('/supabase/setup/preparar-desarrollo.sql'));assert.ok(!preview.assets.has('/AGENTS.md'));
 assert.ok(preview.assets.has('/entrenamiento/js/lib/auth-client.mjs'));assert.ok(html.indexOf('sync-storage.js')<html.indexOf('entrenamiento.js?'));
 assert.equal(await readFile(path,'utf8'),before);
});
test('development preview defaults to no remote sends without explicit flag',async()=>{
 const preview=await buildPreview();assert.ok(preview.pages.get('/entrenamiento/').includes('"enabled":false'));
});
