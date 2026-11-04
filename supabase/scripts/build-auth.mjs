import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const output=new URL('../../entrenamiento/js/lib/',import.meta.url);
await mkdir(output,{recursive:true});
await build({stdin:{contents:"export {GoTrueClient} from '@supabase/auth-js';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,format:'esm',platform:'browser',target:['es2020'],minify:true,legalComments:'eof',
 outfile:new URL('auth-client.mjs',output).pathname,banner:{js:'// Generated from @supabase/auth-js 2.118.0. See AUTH-LICENSES.txt. Do not edit.'}});
const license=(await readFile(new URL('../node_modules/@supabase/auth-js/LICENSE',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const tslib=(await readFile(new URL('../node_modules/tslib/LICENSE.txt',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
await writeFile(new URL('AUTH-LICENSES.txt',output),`@supabase/auth-js 2.118.0\n${license}\n\ntslib 2.8.1\n${tslib}`);
const raw=JSON.parse(await readFile(new URL('../../entrenamiento/config/supabase.public.json',import.meta.url),'utf8'));
const config={enabled:raw.enabled===true,historyEnabled:raw.historyEnabled===true,usageEnabled:raw.usageEnabled===true,cityUrl:raw.cityUrl,url:raw.url,publishableKey:raw.publishableKey,...(raw.turnstileSiteKey?{turnstileSiteKey:raw.turnstileSiteKey}:{})};
await writeFile(new URL('../../entrenamiento/js/sync-config.js',import.meta.url),`// Generated public configuration. Secrets are server-only.\nwindow.ArbatTrainingSyncConfig=window.ArbatTrainingSyncConfig||Object.freeze(${JSON.stringify(config,null,2)});\n`);
