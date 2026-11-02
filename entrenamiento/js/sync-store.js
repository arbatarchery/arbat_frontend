(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatSyncStore=api;})(globalThis,()=>{
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const canonical=value=>JSON.stringify(value,function(key,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;});
 const fingerprint=async(value,crypto)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
 const uuid=crypto=>{if(!crypto?.randomUUID)throw new Error('secure_uuid_unavailable');return crypto.randomUUID();};
 const arrowsOf=s=>[...(s.completed||[]).flatMap(e=>e.arrows||[]),...(s.current||s.arrows||[])];
 const text=v=>v==null?null:String(v);
 const instant=v=>v==null||v===''?null:(Number.isFinite(Date.parse(v))?new Date(v).toISOString():(()=>{throw new Error('invalid_timestamp');})());
 function sessionPayload(s){
  if(s.date!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(s.date))throw new Error('invalid_date');
  return {legacy_session_id:text(s.id),local_date:s.date||null,timezone:s.timezone||null,started_at:instant(s.startedAt),
   session_type:s.sessionType||'training',arrows_per_end:s.arrowsPerEnd==null?null:Number(s.arrowsPerEnd),
   shooting_distance:text(s.shootingDistance),target_size:text(s.targetSize),notes:s.notes||''};
 }
 function arrowPayload(a,endId,ordinal){
  const score=Number(a.score),label=String(a.label??'');
  if(!['M','X','1','2','3','4','5','6','7','8','9','10'].includes(label)||!Number.isInteger(score)
   ||score<0||score>10||(label==='M'?score!==0:label==='X'?score!==10:Number(label)!==score))throw new Error('invalid_arrow');
  const coordinate=v=>v==null||v===''?null:Number(v);
  let x=coordinate(a.x),y=coordinate(a.y);
  if(x!==null&&!Number.isFinite(x)||y!==null&&!Number.isFinite(y))throw new Error('invalid_coordinate');
  if(x===null||y===null){x=null;y=null;}
  return {end_id:endId,ordinal,label,score,x,y,recorded_at:instant(a.recordedAt)};
 }
 function project(snapshot,previous,crypto){
  if(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.completed||[])||!Array.isArray(snapshot.current||snapshot.arrows||[]))throw new Error('invalid_session');
  const session=sessionPayload(snapshot);
  if(!['training','competition'].includes(session.session_type)||session.arrows_per_end!==null&&![3,6,12].includes(session.arrows_per_end))throw new Error('invalid_session_options');
  if(typeof session.notes!=='string'||session.notes.length>10000)throw new Error('invalid_notes');
  const ends=(snapshot.completed||[]).map((e,i)=>({id:previous?.ends[i]?.id||uuid(crypto),payload:{ordinal:i+1,ended_at:instant(e.endedAt),
   arrow_limit:e.arrowLimit==null?null:Number(e.arrowLimit),session_type:e.sessionType||null,shooting_distance:text(e.shootingDistance),target_size:text(e.targetSize),notes:e.notes??null}}));
  const buckets=new Map();
  for(const a of previous?.arrows||[]){if(!buckets.has(a.signature))buckets.set(a.signature,[]);buckets.get(a.signature).push(a.id);}
  const arrows=[];
  const add=(a,endId,i)=>{const signature=canonical(a);arrows.push({id:buckets.get(signature)?.shift()||uuid(crypto),signature,payload:arrowPayload(a,endId,i+1)});};
  (snapshot.completed||[]).forEach((e,i)=>{if(!Array.isArray(e.arrows))throw new Error('invalid_end');e.arrows.forEach((a,n)=>add(a,ends[i].id,n));});
  (snapshot.current||snapshot.arrows||[]).forEach((a,i)=>add(a,null,i));
  return {session,ends,arrows,closedAt:instant(snapshot.endedAt)};
 }
 class Store{
  constructor({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto,name='arbat-training-sync-v1',now=Date.now}={}){
   this.factory=indexedDB;this.crypto=crypto;this.name=name;this.now=now;this.opening=null;this.runId=crypto?.randomUUID?.();
  }
  open(){if(this.opening)return this.opening;this.opening=new Promise((resolve,reject)=>{
   if(!this.factory){reject(new Error('indexeddb_unavailable'));return;}
   let failed=false;const timeout=setTimeout(()=>{failed=true;reject(new Error('indexeddb_timeout'));},5000);
   const request=this.factory.open(this.name,1);
   request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('sessions',{keyPath:'key'});const ops=db.createObjectStore('operations',{keyPath:'operation_id'});ops.createIndex('sessionKey','sessionKey');db.createObjectStore('meta',{keyPath:'key'});};
   request.onerror=()=>{clearTimeout(timeout);failed=true;reject(request.error);};request.onblocked=()=>{clearTimeout(timeout);failed=true;reject(new Error('indexeddb_blocked'));};
   request.onsuccess=()=>{clearTimeout(timeout);const db=request.result;if(failed){db.close();return;}db.onversionchange=()=>{db.close();this.opening=null;};resolve(db);};
  });this.opening=this.opening.catch(error=>{this.opening=null;throw error;});return this.opening;}
  async close(){if(this.opening)(await this.opening).close();this.opening=null;}
  async transaction(names,mode,work){const db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction(names,mode);let result,failure;
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure||tx.error||new Error('transaction_aborted'));tx.onerror=()=>{};
   try{work(tx,value=>{result=value;},error=>{failure=error;tx.abort();});}catch(error){failure=error;tx.abort();}
  });}
  async readAll(name){return this.transaction([name],'readonly',(tx,done)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>done(r.result);});}
  async meta(key,value){return this.transaction(['meta'],value===undefined?'readonly':'readwrite',(tx,done)=>{const s=tx.objectStore('meta');if(value===undefined){const r=s.get(key);r.onsuccess=()=>done(r.result?.value);}else{s.put({key,value});done(value);}});}
  async changeMeta(key,change){return this.transaction(['meta'],'readwrite',(tx,done,fail)=>{const s=tx.objectStore('meta'),r=s.get(key);r.onsuccess=()=>{try{const value=change(r.result?.value);if(value===undefined)s.delete(key);else s.put({key,value});done(value);}catch(error){fail(error);}};});}
  async resolveKey(snapshot,source,hash,importing=false){
   const legacy=snapshot.id==null?'':String(snapshot.id);const alias=legacy?`id:${legacy}`:`source:${source}:${source==='current'?'active':hash}`;
   return this.transaction(['meta'],'readwrite',(tx,done,fail)=>{
    const meta=tx.objectStore('meta'),a=meta.get(alias),b=meta.get(`active:${source}`);let n=0;
    const ready=()=>{if(++n!==2)return;try{
     let key=a.result?.value?.key;
     const active=b.result?.value;
     if(!key&&source==='current'&&active&&(!active.legacy||active.legacy===legacy))key=active.key;
     key=key||(UUID.test(legacy)?legacy.toLowerCase():uuid(this.crypto));
     meta.put({key:alias,value:{key,legacy}});if(source==='current'&&(!importing||!active))meta.put({key:`active:${source}`,value:{key,legacy}});done(key);
    }catch(error){fail(error);}};a.onsuccess=ready;b.onsuccess=ready;
   });
  }
  async update(key,change){return this.transaction(['sessions','operations'],'readwrite',(tx,done,fail)=>{
   const sessions=tx.objectStore('sessions'),operations=tx.objectStore('operations');const a=sessions.get(key),b=operations.index('sessionKey').getAll(key);let n=0;
   const ready=()=>{if(++n!==2)return;try{const output=change(a.result,b.result);if(output?.session)sessions.put(output.session);for(const op of output?.add||[])operations.put(op);for(const id of output?.remove||[])operations.delete(id);done(output?.result);}catch(error){fail(error);}};
   a.onsuccess=ready;b.onsuccess=ready;
  });}
  async capture(value,{source='current',priority=0,legacySaved=true,expectedFingerprint,previousSnapshot,importing=false}={}){
   const snapshot=clone(value),hash=await fingerprint(snapshot,this.crypto),key=await this.resolveKey(snapshot,source,hash,importing);
   if(previousSnapshot)expectedFingerprint=await fingerprint(previousSnapshot,this.crypto);
   return this.update(key,(existing,operations)=>{
    const record=existing||{key,id:key,sequence:0,confirmedRevision:0,accountKey:snapshot.owner?.anonymous===false?text(snapshot.owner.id):null,
     originAnonymousId:snapshot.owner?.anonymousId||null,principalId:null,priority,projection:null};
    if(existing&&record.fingerprint===hash)return {result:clone(record)};
    if(importing&&existing&&(!record.legacySaved||record.liveCaptured===this.runId))return {result:clone(record)};
    if(importing&&existing&&source!=='current'){
     const before=arrowsOf(record.snapshot||{}).map(canonical),after=arrowsOf(snapshot).map(canonical);
     const prefix=(a,b)=>a.every((v,i)=>v===b[i]);
     if(before.length>after.length&&prefix(after,before))return {result:clone(record)};
     if(!prefix(before,after)){
      record.issue='ambiguous_legacy_version';record.alternatives=[...(record.alternatives||[]),{snapshot,fingerprint:hash}].slice(-10);return {session:record,result:clone(record)};
     }
    }
    if(expectedFingerprint!==undefined&&existing&&record.fingerprint!==expectedFingerprint){
     record.issue='concurrent_local_change';record.alternatives=[...(record.alternatives||[]),{snapshot,fingerprint:hash}].slice(-10);return {session:record,result:clone(record)};
    }
    // A stale current/legacy copy cannot reopen an archived session.
    if(record.projection?.closedAt&&importing&&!snapshot.endedAt)return {result:clone(record)};
    if(record.accountKey&&snapshot.owner?.anonymous===false&&String(snapshot.owner.id)!==record.accountKey){record.issue='account_mismatch';return {session:record,result:clone(record)};}
    if(!record.accountKey&&snapshot.owner?.anonymous===false)record.accountKey=text(snapshot.owner.id);
    let next;
    try{next=project(snapshot,record.projection,this.crypto);}catch(error){record.issue=error.message;record.alternatives=[...(record.alternatives||[]),{snapshot,fingerprint:hash}].slice(-10);return {session:record,result:clone(record)};}
    const previous=record.projection;
    if(previous?.closedAt&&canonical(previous)!==canonical(next)){record.issue='closed_session_changed';return {session:record,result:clone(record)};}
    const add=[];
    const enqueue=(kind,entity,payload)=>add.push({operation_id:uuid(this.crypto),session_id:key,entity_id:entity,kind,payload:clone(payload),sessionKey:key,
     sequence:++record.sequence,state:'pending',envelope:null,nextAttemptAt:0,attempts:0});
    if(arrowsOf(snapshot).length||record.sequence>0){
     if(!record.sequence||!previous||canonical(previous.session)!==canonical(next.session))enqueue('session.upsert',key,next.session);
     for(const a of previous?.arrows||[])if(!next.arrows.some(n=>n.id===a.id))enqueue('arrow.delete',a.id,{});
     for(const e of next.ends)if(!previous?.ends.some(p=>p.id===e.id&&canonical(p.payload)===canonical(e.payload)))enqueue('end.upsert',e.id,e.payload);
     for(const a of next.arrows)if(!previous?.arrows.some(p=>p.id===a.id&&canonical(p.payload)===canonical(a.payload)))enqueue('arrow.upsert',a.id,a.payload);
     if(next.closedAt&&!previous?.closedAt)enqueue('session.close',key,{ended_at:next.closedAt});
    }
    const legacyBaseline=legacySaved?null:record.legacySaved===false&&expectedFingerprint===record.fingerprint?record.legacyBaseline:expectedFingerprint||null;
    Object.assign(record,{snapshot,fingerprint:hash,projection:next,legacySaved,legacyBaseline,localSaved:true,liveCaptured:importing?null:this.runId,priority:Math.min(record.priority,priority),capturedAt:this.now()});
    return {session:record,add,result:clone(record)};
   });
  }
  async importLegacy(storage){
   const issues=[],sources=[];let keys=[];
   try{for(let i=0;i<storage.length;i++)keys.push(storage.key(i));}catch{issues.push({source:'storage',code:'storage_unavailable'});}
   keys=[...new Set(['arbat-training-current','arbat-training-history',...keys.filter(k=>/^arbat-training-\d{4}-\d{2}-\d{2}$/.test(k))])];
   for(const key of keys){let raw;try{raw=storage.getItem(key);}catch{issues.push({source:key,code:'storage_unavailable'});continue;}if(!raw)continue;
    try{const parsed=JSON.parse(raw);const list=key==='arbat-training-history'?parsed:[parsed];if(!Array.isArray(list))throw new Error();
     const counts=new Map();for(const snapshot of list){try{const hash=await fingerprint(snapshot,this.crypto),occurrence=counts.get(hash)||0;counts.set(hash,occurrence+1);
      sources.push({snapshot,source:key==='arbat-training-current'?'current':`${key}:${occurrence}`,priority:key==='arbat-training-current'?0:1});
     }catch{issues.push({source:key,code:'invalid_session'});}}
    }catch{issues.push({source:key,code:'invalid_json'});}
   }
   const records=[];
   for(const entry of sources){try{const record=await this.capture(entry.snapshot,{...entry,importing:true});records.push(record);if(record.issue)issues.push({source:entry.source,code:record.issue});}catch{issues.push({source:entry.source,code:'import_failed'});}}
   // Equal ownerless records in distinct sources remain separate: ambiguity is reported, never silently deduplicated.
   const seen=new Map();for(const record of records){if(record.snapshot?.id)continue;const hash=record.fingerprint;if(seen.has(hash)&&seen.get(hash)!==record.key)issues.push({source:record.key,code:'ambiguous_legacy_duplicate'});seen.set(hash,record.key);}
   await this.meta('import-report',{issues,completedAt:this.now()});return {records,issues};
  }
  async prepare(key,identity){return (await this.prepareBatch(key,identity,{limit:1}))[0]||null;}
  async prepareBatch(key,identity,{limit=32,maxBytes=122880}={}){return this.update(key,(record,ops)=>{
   if(!record||record.issue||record.accountKey&&record.accountKey!==identity.accountKey||record.principalId&&record.principalId!==identity.principalId)return {result:[]};
   const batch=[],updates=[];let bytes=new TextEncoder().encode(JSON.stringify({schema_version:1,action:'sync',operations:[]})).length;
   for(const op of ops.sort((a,b)=>a.sequence-b.sequence)){
    if(batch.length>=Math.min(32,limit)||op.state==='blocked'||op.nextAttemptAt>this.now())break;
    const revision=record.confirmedRevision+batch.length;
    if(op.envelope&&op.envelope.base_revision!==revision)throw new Error('batch_revision_mismatch');
    const envelope=op.envelope||{operation_id:op.operation_id,session_id:op.session_id,entity_id:op.entity_id,kind:op.kind,base_revision:revision,payload:clone(op.payload)};
    const size=new TextEncoder().encode(JSON.stringify(envelope)).length+(batch.length?1:0);
    if(bytes+size>maxBytes){if(!batch.length)throw new Error('operation_too_large');break;}
    bytes+=size;op.envelope=envelope;op.state='sending';updates.push(op);batch.push(clone(envelope));
   }
   if(!batch.length)return {result:[]};
   record.principalId=identity.principalId;if(identity.accountKey&&!record.accountKey)record.accountKey=identity.accountKey;
   return {session:record,add:updates,result:batch};
  });}
  async recoverCurrent(){const active=await this.meta('active:current');if(!active)return null;
   return this.transaction(['sessions'],'readonly',(tx,done)=>{const r=tx.objectStore('sessions').get(active.key);r.onsuccess=()=>done(r.result?clone(r.result):null);});
  }
  async assignAccount(keys,principalId,accountKey){if(!accountKey)return;return this.transaction(['sessions'],'readwrite',(tx,done)=>{const store=tx.objectStore('sessions');for(const key of keys){const r=store.get(key);r.onsuccess=()=>{const row=r.result;if(row&&!row.accountKey&&(!row.principalId||row.principalId===principalId))store.put({...row,accountKey});};}done(true);});}
  async confirmClaim(identity,result){
   if(!identity?.accountKey||!UUID.test(identity.principalId||'')||result?.status!=='accepted'||!UUID.test(result.owner_id||'')||!Number.isSafeInteger(result.sessions_claimed)||result.sessions_claimed<0||result.sessions_claimed>10000||typeof result.replayed!=='boolean')return null;
   const accountKey=String(identity.accountKey),key='claim-confirmation:'+JSON.stringify([accountKey,identity.principalId]);
   await this.changeMeta(key,previous=>{
    const same=previous?.ownerId===result.owner_id;
    return {accountKey,principalId:identity.principalId,ownerId:result.owner_id,
     sessionsClaimed:result.replayed?(same?previous.sessionsClaimed:null):result.sessions_claimed,
     confirmedAt:this.now()};
   });
   const receipts=(await this.readAll('meta')).filter(row=>row.key.startsWith('claim-confirmation:')).map(row=>row.value).filter(row=>row.accountKey===accountKey&&row.ownerId===result.owner_id);
   return {accountKey,ownerId:result.owner_id,sessionsClaimed:receipts.every(row=>Number.isSafeInteger(row.sessionsClaimed))?receipts.reduce((sum,row)=>sum+row.sessionsClaimed,0):null,confirmedAt:Math.max(...receipts.map(row=>row.confirmedAt))};
  }
  async acknowledge(key,id,result){return this.update(key,(record,ops)=>{
   const op=ops.find(o=>o.operation_id===id);if(!record||!op)return {result:false};
   if(result.status!=='accepted'||!Number.isSafeInteger(result.revision)||result.revision!==op.envelope?.base_revision+1)throw new Error('invalid_ack');
   record.confirmedRevision=result.revision;record.lastConfirmedAt=this.now();return {session:record,remove:[id],result:true};
  });}
  async fail(key,id,code,{permanent=false,delayMs=1000}={}){return this.update(key,(record,ops)=>{
   const op=ops.find(o=>o.operation_id===id);if(!op)return {result:false};op.state=permanent?'blocked':'pending';op.error=code;op.attempts++;op.nextAttemptAt=this.now()+delayMs;
   return {add:[op],result:true};
  });}
  async acquireLease(owner,ttl=30000,key='sync-lease'){return this.transaction(['meta'],'readwrite',(tx,done)=>{
   const s=tx.objectStore('meta'),r=s.get(key);r.onsuccess=()=>{const lease=r.result?.value;
    if(lease&&lease.owner!==owner&&lease.until>this.now()){done(false);return;}
    s.put({key,value:{owner,until:this.now()+ttl}});done(true);
   };
  });}
  async releaseLease(owner,key='sync-lease'){return this.transaction(['meta'],'readwrite',(tx,done)=>{const s=tx.objectStore('meta'),r=s.get(key);r.onsuccess=()=>{if(r.result?.value?.owner===owner)s.delete(key);done(true);};});}
  async status(){const [sessions,ops,report]=await Promise.all([this.readAll('sessions'),this.readAll('operations'),this.meta('import-report')]);
   return {pending:ops.length,blocked:ops.filter(o=>o.state==='blocked').length,issues:sessions.filter(s=>s.issue).map(s=>s.issue).concat(report?.issues?.map(i=>i.code)||[]),
    localSaved:sessions.every(s=>s.localSaved),lastConfirmedAt:Math.max(0,...sessions.map(s=>s.lastConfirmedAt||0))||null};
  }
 }
 return {Store,canonical,fingerprint,project};
});
