import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {buildPreview,root} from './preview-page.mjs';
const cloudEnabled=process.argv.includes('--enable-cloud'),preview=await buildPreview({cloudEnabled,historyEnabled:process.argv.includes('--enable-history')});
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 if(req.headers.host!=='localhost:8000'){res.statusCode=400;res.end('Abre http://localhost:8000');return;}
 if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.end();return;}
 try{
  const path=new URL(req.url,'http://localhost:8000').pathname;
  let data,type;
  if(path==='/'){data=preview.shell;type='text/html';}
  else if(preview.pages.has(path)){data=preview.pages.get(path);type='text/html';}
  else if(preview.assetFiles.has(path)){data=await readFile(preview.assetFiles.get(path));type='text/javascript';}
  else if(preview.assets.has(path)){data=await readFile(resolve(root,'.'+path));type=extname(path)==='.css'?'text/css':'text/javascript';}
  else{res.statusCode=404;res.end('No disponible en la vista previa.');return;}
  res.setHeader('Content-Type',type+'; charset=utf-8');res.end(req.method==='HEAD'?undefined:data);
 }catch{res.statusCode=500;res.end('No se pudo cargar la vista previa.');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'El puerto 8000 ya esta ocupado. No se sustituyo el servidor existente.':'No se pudo iniciar el servidor local.');process.exitCode=1;});
server.listen(8000,'127.0.0.1',()=>console.log(`Vista previa: http://localhost:8000\nRespaldo para esta vista previa: ${cloudEnabled?'habilitado':'desactivado'}\nAlmacenamiento aislado; configuracion publicada sin cambios.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
