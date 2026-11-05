(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatSyncHistory=api;})(globalThis,()=>{
 'use strict';
 const error=code=>Object.assign(new Error(code),{code});
 const scope=id=>id.accountKey?`buddy:${id.accountKey}`:`anon:${id.principalId}`;
 class Reader{
  constructor({enabled=false,url,publicKey,identityProvider,transport,fetchImpl=globalThis.fetch,concurrency=3}={}){Object.assign(this,{enabled,url,publicKey,identityProvider,transport,fetchImpl});this.fetchImpl=(...args)=>fetchImpl(...args);this.parts=new Map();this.claimed=new Set();this.claiming=new Map();this.concurrency=Math.max(1,Math.min(3,Number.isInteger(concurrency)?concurrency:3));}
  async request(body,identity,signal){
   const diagnosticStart=Date.now();
   try{
   signal?.throwIfAborted();const current=await this.identityProvider();signal?.throwIfAborted();if(!current||scope(current)!==scope(identity))throw error('auth_changed');
   if(current.accountKey){
    const signature=`${current.principalId}:${current.accountKey}`;
    if(!this.claimed.has(signature)){
     let pending=this.claiming.get(signature);
     if(!pending){pending=(async()=>{const result=await this.transport.claim(current);if(result.status!=='accepted')throw error(result.status);this.claimed.add(signature);})().finally(()=>this.claiming.delete(signature));this.claiming.set(signature,pending);}
     await pending;
    }
   }
   signal?.throwIfAborted();
   const headers={'Content-Type':'application/json',apikey:this.publicKey,Authorization:`Bearer ${current.supabaseToken||this.publicKey}`};if(current.buddyToken)headers['x-buddy-access-token']=current.buddyToken;
   const signals=[AbortSignal.timeout(10000)];if(signal)signals.push(signal);
   const response=await this.fetchImpl(`${this.url.replace(/\/$/,'')}/functions/v1/training-sync`,{method:'POST',headers,body:JSON.stringify({schema_version:1,...body}),signal:AbortSignal.any(signals),cache:'no-store',redirect:'error'});
   if(!response.ok){let code=null;try{const data=await response.json();code=data.error;}catch{}throw Object.assign(error(response.status===429?'rate_limited':response.status===401?'auth_required':'history_unavailable'),{httpStatus:response.status,serverCode:code});}
   const reader=response.body.getReader();let length=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1048576)throw error('history_response_limit');chunks.push(value);}}finally{reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   signal?.throwIfAborted();const result=JSON.parse(new TextDecoder().decode(bytes));if(!['accepted','changed','gone'].includes(result.status))throw error('history_unavailable');globalThis.ArbatDiagnostics?.record({service:body.action==='system.status'?'database':body.action==='history.context'?'identity':body.action==='usage.summary'?'usage':'history',action:body.action,code:'ok',http:response.status,ms:Date.now()-diagnosticStart});return result;
   }catch(cause){
    if(signal?.aborted)throw cause;
    const failure=typeof cause?.code==='string'?cause:error(cause?.name==='TimeoutError'?'history_timeout':cause?.name==='SyntaxError'?'history_invalid_json':cause?.name==='TypeError'?'history_network_error':'history_unavailable');
    failure.historyAction=body.action;if(['ends','arrows'].includes(body.collection))failure.historyCollection=body.collection;
    globalThis.ArbatDiagnostics?.record({service:body.action==='system.status'?'database':body.action==='history.context'?'identity':body.action==='usage.summary'?'usage':'history',action:body.action,code:failure.serverCode||failure.code,http:failure.httpStatus});
    throw failure;
   }
  }
  async context({signal}={}){
   if(!this.enabled)throw error('history_disabled');const identity=await this.identityProvider();if(!identity)throw error('auth_required');
   return this.request({action:'history.context'},identity,signal);
  }
  async systemStatus({signal}={}){
   if(!this.enabled)throw error('history_disabled');const identity=await this.identityProvider();if(!identity?.accountKey)throw error('auth_required');
   return this.request({action:'system.status'},identity,signal);
  }
  async usageSummary({from,to,signal}){
   if(!this.enabled)throw error('history_disabled');const identity=await this.identityProvider();if(!identity?.accountKey)throw error('auth_required');
   return this.request({action:'usage.summary',from,to},identity,signal);
  }
  async coachOverview({from,to,signal,onProgress=()=>{}}){
   if(!this.enabled)throw error('history_disabled');const identity=await this.identityProvider();if(!identity?.accountKey)throw error('auth_required');
   let cursor=null,overview=null;const seen=new Set();
   do{
    const page=await this.request({action:'history.coach',from,to,cursor,scope_hash:overview?.scope_hash??null},identity,signal);
    if(page.status==='changed')throw error('history_changed');
    if(!Array.isArray(page.athletes)||page.athletes.length>32||!Array.isArray(page.days)||typeof page.scope_hash!=='string')throw error('invalid_history_page');
    if(!overview)overview={...page,athletes:[]};
    overview.athletes.push(...page.athletes);onProgress({athletes:overview.athletes.length});if(overview.athletes.length>10000)throw error('history_response_limit');
    cursor=page.next_cursor;if(cursor&&seen.has(cursor))throw error('invalid_history_cursor');if(cursor)seen.add(cursor);
   }while(cursor);
   return overview;
  }
  async get({from,to,targetSubject=null,signal,onProgress=()=>{}}){
   this.controller?.abort();const controller=new AbortController();this.controller=controller;
   try{return await this.load({from,to,targetSubject,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,onProgress});}finally{if(this.controller===controller)this.controller=null;}
  }
  async load({from,to,targetSubject,signal,onProgress}){
   if(!this.enabled)throw error('history_disabled');const identity=await this.identityProvider();if(!identity)throw error('auth_required');
   const sessions=[],deletedIds=[],observed=new Map(),completed=new Set(),cursors=new Set();let cursor=null;
   const report=()=>{
    if(signal?.aborted)return;
    const parts=[...observed.values()];onProgress(completed.size,{sessions:completed.size,ends:parts.reduce((n,p)=>n+p.ends.length,0),arrows:parts.reduce((n,p)=>n+p.arrows.length,0)});
   };
   const loadSession=async(metadata,pageSignal)=>{
    if(typeof metadata.id!=='string'||!Number.isSafeInteger(metadata.revision)||metadata.revision<1)throw error('invalid_history_metadata');
    if(metadata.deletedAt){deletedIds.push(metadata.id);return null;}
    const key=`${scope(identity)}:${metadata.id}:${metadata.revision}`;let part=this.parts.get(key);
    if(!part){if(this.parts.size>=1000)throw error('history_cache_limit');part={ends:[],arrows:[],cursor:{ends:null,arrows:null},done:{ends:false,arrows:false}};this.parts.set(key,part);}
    observed.set(metadata.id,part);report();
    for(const collection of ['ends','arrows']){
     while(!part.done[collection]){
      const detail=await this.request({action:'history.detail',session_id:metadata.id,revision:metadata.revision,collection,cursor:part.cursor[collection]},identity,pageSignal);
      if(detail.status==='changed'){this.parts.delete(key);throw error('history_changed');}
      if(detail.status==='gone'){deletedIds.push(metadata.id);observed.delete(metadata.id);report();return null;}
      if(!Array.isArray(detail.items)||detail.revision!==metadata.revision)throw error('invalid_history_detail');
      if(detail.next_cursor&&detail.next_cursor===part.cursor[collection])throw error('invalid_history_cursor');
      part[collection].push(...detail.items);part.cursor[collection]=detail.next_cursor;part.done[collection]=!detail.next_cursor;report();
     }
    }
    pageSignal.throwIfAborted();
    const arrow=a=>({id:a.id,label:a.label,score:a.score,x:a.x,y:a.y,recordedAt:a.recorded_at});
    const ordered=part.arrows.slice().sort((a,b)=>a.ordinal-b.ordinal);
    const endIds=new Set(part.ends.map(e=>e.id));if(ordered.some(a=>a.end_id&&!endIds.has(a.end_id)))throw error('invalid_history_parent');
    const ends=part.ends.slice().sort((a,b)=>a.ordinal-b.ordinal).map(e=>({id:e.id,arrows:ordered.filter(a=>a.end_id===e.id).map(arrow),endedAt:e.ended_at,arrowLimit:e.arrow_limit,sessionType:e.session_type,shootingDistance:e.shooting_distance,targetSize:e.target_size,notes:e.notes}));
    completed.add(metadata.id);report();return {...metadata,completed:ends,current:ordered.filter(a=>!a.end_id).map(arrow)};
   };
   do{
    const page=await this.request({action:'history.list',from,to,cursor,target_subject:targetSubject},identity,signal);report();
    if(!Array.isArray(page.sessions)||page.sessions.length>8)throw error('invalid_history_page');
    const controller=new AbortController(),pageSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const results=new Array(page.sessions.length);let next=0,firstError=null;
    const worker=async()=>{
     while(next<page.sessions.length&&!firstError){
      const index=next++;
      try{results[index]=await loadSession(page.sessions[index],pageSignal);}catch(cause){if(!firstError){firstError=cause;controller.abort(cause);}}
     }
    };
    // Stop and join sibling requests before returning an error, so a retry cannot
    // append duplicate pages while requests from the failed load are still running.
    await Promise.all(Array.from({length:Math.min(this.concurrency,page.sessions.length)},worker));
    if(firstError)throw firstError;
    sessions.push(...results.filter(Boolean));
    cursor=page.next_cursor;
    if(cursor&&cursors.has(cursor))throw error('invalid_history_cursor');if(cursor)cursors.add(cursor);
   }while(cursor);
   signal?.throwIfAborted();const current=await this.identityProvider();signal?.throwIfAborted();if(!current||scope(current)!==scope(identity))throw error('auth_changed');
   return {sessions,deletedIds};
  }

 }
 function merge(local,remote,mappings=[]){
  const result=new Map(remote.sessions.map(s=>[s.id,s])),deleted=new Set(remote.deletedIds||[]),used=new Set();
  const signature=value=>{const copy={...value};delete copy.isCurrent;return JSON.stringify(copy,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);};
  for(const session of local){
   const mapping=mappings.find(m=>!used.has(m.key)&&(session.id?m.snapshot.id===session.id:!m.snapshot.id&&signature(m.normalized||m.snapshot)===signature(session)));
   if(mapping)used.add(mapping.key);
   const key=mapping?.key||(/^[0-9a-f-]{36}$/i.test(session.id||'')?session.id:`local:${session.id||used.size}:${result.size}`);
   if(deleted.has(key)&&!mapping?.pending&&!mapping?.issue)continue;
   const cloud=result.get(key),pending=Boolean(mapping?.pending||mapping?.issue);
   if(!cloud||pending||Number(cloud.revision)<(mapping?.confirmedRevision||0))result.set(key,session);
  }
  return [...result.values()];
 }
 return {Reader,merge};
});
