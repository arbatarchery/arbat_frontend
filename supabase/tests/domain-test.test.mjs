import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {buildDomainTest} from '../scripts/build-domain-test.mjs';
test('domain test exports only isolated pages/assets and leaves live training configuration unchanged',async t=>{
 const destination=await mkdtemp(join(tmpdir(),'arbat-domain-'));t.after(()=>rm(destination,{recursive:true,force:true}));
 const publicConfig=new URL('../../entrenamiento/config/supabase.public.json',import.meta.url),before=await readFile(publicConfig,'utf8');
 const result=await buildDomainTest(destination),html=await readFile(join(destination,'index.html'),'utf8');
 assert.equal(result.route,'/pruebas/supabase/');assert.ok(html.includes('"storagePrefix":"arbat-supabase-domain-test-v1:"'));assert.ok(html.includes('"storeName":"arbat-training-sync-domain-test-v1"'));
 assert.ok(html.includes('"enabled":true'));assert.ok(html.includes('"historyEnabled":false'));assert.ok(html.includes('noindex,nofollow'));assert.ok(html.includes('assets/domain-theme.css?v=2'));await readFile(join(destination,'assets/domain-theme.css'));
 assert.ok(!html.includes('/__preview/'));
 assert.ok(!html.includes('src="/entrenamiento/'));assert.ok(!html.includes('href="/entrenamiento/'));assert.ok(html.includes('href="/pruebas/supabase/historial/"'));
 for(const match of html.matchAll(/(?:src|href)="(\/pruebas\/supabase\/assets\/[^"?]+)(?:\?[^" ]*)?"/g))await readFile(join(destination,match[1].replace('/pruebas/supabase/','')));
 assert.ok((await readFile(join(destination,'assets/test-controls/buddy.js'),'utf8')).includes('https://arbatarchery.com'));
 assert.ok((await readFile(join(destination,'assets/entrenamiento/js/sync-identity.js'),'utf8')).includes('./lib/auth-client.mjs'));await readFile(join(destination,'assets/entrenamiento/js/lib/auth-client.mjs'));await readFile(join(destination,'assets/entrenamiento/js/lib/AUTH-LICENSES.txt'));
 assert.deepEqual((await readdir(destination)).sort(),['.gitattributes','assets','historial','index.html']);assert.equal(await readFile(publicConfig,'utf8'),before);
});
