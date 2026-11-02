import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const sources=['functions/training-sync/index.ts','functions/_shared/training-handler.mjs','functions/_shared/buddy-identity.mjs','functions/_shared/buddy-principal.mjs'];
const hashes=await Promise.all(sources.map(async file=>`// ${file}: ${createHash('sha256').update(await readFile(new URL(`../${file}`,import.meta.url))).digest('hex')}`));
await build({entryPoints:[new URL('../functions/training-sync/index.ts',import.meta.url).pathname],
 outfile:new URL('../setup/training-sync-dashboard.ts',import.meta.url).pathname,bundle:true,format:'esm',platform:'neutral',target:'es2022',minify:false,
 banner:{js:`// @ts-nocheck\n// ARBAT: JavaScript autocontenido para pegar en index.ts del editor de Supabase.\n// Generado desde fuentes revisables; no editar a mano. Sin secretos incluidos.\n// Desactivado por defecto: no configurar TRAINING_SYNC_ENABLED=true todavia.\n${hashes.join('\n')}`}});
