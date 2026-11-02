import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve} from 'node:path';import {buildPreview,root} from './preview-page.mjs';
// Export only isolated browser assets, never the repo, SQL, credentials or docs.
export async function buildDomainTest(destination){
 const preview=await buildPreview({cloudEnabled:true}),route='/pruebas/supabase/';
 const namespace=value=>value.replaceAll('arbat-supabase-preview-v1:','arbat-supabase-domain-test-v1:').replaceAll('arbat-training-sync-preview-v1','arbat-training-sync-domain-test-v1').replaceAll('http://localhost:8000','https://arbatarchery.com');
 const assetPath=path=>'assets'+path.replace('/__preview/','/test-controls/');
 const write=async(path,value)=>{const target=resolve(destination,path);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,path.endsWith('auth-client.mjs')?value:value.trimEnd()+'\n');};
 for(const original of preview.assets){await write(assetPath(original),namespace(await readFile(resolve(root,'.'+original),'utf8')));}
 for(const [path,file]of preview.assetFiles){await write(assetPath(path),namespace(await readFile(file,'utf8')));}
 await write('assets/entrenamiento/js/lib/AUTH-LICENSES.txt',await readFile(resolve(root,'entrenamiento/js/lib/AUTH-LICENSES.txt'),'utf8'));
 await write('assets/domain-theme.css',await readFile(new URL('./domain-theme.css',import.meta.url),'utf8'));
 await write('.gitattributes','assets/entrenamiento/js/lib/auth-client.mjs whitespace=-blank-at-eol\n');
 for(const [path,original]of preview.pages){
  let html=namespace(original).replace('<head>','<head><meta name="robots" content="noindex,nofollow">');
  if(path==='/entrenamiento/')html=html.replace('</head>',`<link rel="stylesheet" href="${route}assets/domain-theme.css?v=2"></head>`);
  for(const asset of [...preview.assets,...preview.assetFiles.keys()].sort((a,b)=>b.length-a.length))html=html.replaceAll(asset,route+assetPath(asset));
  html=html.replaceAll('href="/entrenamiento/','href="'+route).replaceAll('Prueba local','Prueba Supabase en dominio real').replaceAll('prueba local','prueba Supabase');
  html=html.replace('Prueba Supabase en dominio real · Solo datos ficticios','PRUEBA AISLADA · Solo datos ficticios · No utiliza tus entrenamientos habituales');
  const relative=path==='/entrenamiento/'?'index.html':'historial/index.html';await write(relative,html);
 }
 return {route,namespace:'arbat-supabase-domain-test-v1:',files:preview.assets.size+preview.assetFiles.size+preview.pages.size+3};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===resolve(process.argv[1])){
 const destination=process.argv[2];if(!destination)throw new Error('Indica un directorio de salida nuevo para la prueba aislada.');
 console.log(JSON.stringify(await buildDomainTest(resolve(destination))));
}
