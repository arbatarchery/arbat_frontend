(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatSyncUsage=api;})(globalThis,()=>{
 'use strict';
 class Usage{
  constructor({store,url,publicKey,cityUrl,identityProvider,accountProvider=()=>null,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,now=()=>Date.now(),online=()=>globalThis.navigator?.onLine!==false}={}){
   Object.assign(this,{store,url,publicKey,cityUrl,identityProvider,accountProvider,fetchImpl:fetchImpl.bind(globalThis),cryptoImpl,now,online});this.startedAt=now();this.owner=cryptoImpl.randomUUID();this.chain=Promise.resolve();this.timer=null;
  }
  async browser(){return this.store.changeMeta('usage-browser',old=>old||this.cryptoImpl.randomUUID());}
  async enqueue(kind,{session_id,end_id,occurred_at}={},key){
   const browser_id=await this.browser();
   const row=await this.store.changeMeta(key||'usage-event:'+this.cryptoImpl.randomUUID(),old=>old||{event_id:this.cryptoImpl.randomUUID(),browser_id,kind,occurred_at:occurred_at||new Date(this.now()).toISOString(),
    ...(session_id?{session_id,end_id}:{}),accountKey:this.accountProvider()||null,createdAt:this.now(),ack:false});
   return row;
  }
  async openHistory(){
   if(this.opening)return this.opening;
   const key='usage-open:'+this.cryptoImpl.randomUUID();this.opening=key;
   await this.enqueue('history_open',{occurred_at:new Date(this.startedAt).toISOString()},key);this.schedule();return key;
  }
  async observe(record){
   if(!record?.projection||record.issue)return;
   for(const end of record.projection.ends||[]){
    const stamp=Date.parse(end.payload?.ended_at);
    // Imported/previous ends are not evidence of the current training location.
    if(!Number.isFinite(stamp)||stamp<this.startedAt-2000)continue;
    await this.enqueue('end_location',{session_id:record.key,end_id:end.id,occurred_at:new Date(stamp).toISOString()},'usage-end:'+end.id);
   }
   this.schedule();
  }
  schedule(delay=0){if(this.stopped)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(()=>{}),delay);this.timer?.unref?.();}
  async json(response,limit=8192){
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('usage_response_limit');chunks.push(value);}}
   finally{reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
  }
  async flush(){
   if(this.running)return this.running;
   this.running=this.drain().finally(()=>{this.running=null;if(!this.stopped)this.schedule(30000);});return this.running;
  }
  async drain(){
   if(!this.online()||!await this.store.acquireLease(this.owner,120000,'usage-lease'))return;
   try{
    const account=this.accountProvider()||null,rows=await this.store.readAll('meta');let sent=0;
    for(const entry of rows){
     if(!/^usage-(open|end|event):/.test(entry.key))continue;
     let row=entry.value;
     if(row.ack&&!(entry.key===this.opening&&!row.accountKey&&account))continue;
     if(row.accountKey&&row.accountKey!==account)continue;
     if(this.now()-row.createdAt>365*86400000){await this.store.changeMeta(entry.key,()=>undefined);continue;}
     if(row.nextAttemptAt>this.now())continue;
     if(sent++>=4)break;
     row={...row,nextAttemptAt:this.now()+60000};await this.store.meta(entry.key,row);
     try{
      if(!row.proof||this.now()-Date.parse(row.observed_at)>6*86400000){
       const city=new URL(this.cityUrl);for(const [k,v] of Object.entries({event_id:row.event_id,browser_id:row.browser_id,event_kind:row.kind}))city.searchParams.set(k,v);
       const response=await this.fetchImpl(city.href,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(4000)});
       const data=await this.json(response);if(!response.ok||typeof data.proof!=='string'||data.proof.length>4096)throw new Error('city_unavailable');
       row={...row,proof:data.proof,observed_at:data.observed_at};await this.store.meta(entry.key,row);
      }
      // This checks only existing credentials; it never opens a CAPTCHA.
      let identity=null;try{identity=await this.identityProvider();}catch{}
      if(row.kind==='end_location'&&!identity)continue;
      if(this.accountProvider()!==account||row.accountKey&&identity?.accountKey!==row.accountKey)continue;
      // Anonymous openings must not inherit another account's stale credentials.
      if(!account)identity=null;
      if(row.kind==='end_location'&&!identity){try{identity=await this.identityProvider();}catch{}if(!identity||identity.accountKey)continue;}
      const headers={'Content-Type':'application/json',apikey:this.publicKey,Authorization:`Bearer ${identity?.supabaseToken||this.publicKey}`};
      if(identity?.buddyToken)headers['x-buddy-access-token']=identity.buddyToken;
      const event={event_id:row.event_id,browser_id:row.browser_id,kind:row.kind,occurred_at:row.occurred_at,proof:row.proof,...(row.session_id?{session_id:row.session_id,end_id:row.end_id}:{})};
      const response=await this.fetchImpl(this.url.replace(/\/$/,'')+'/functions/v1/training-sync',{method:'POST',headers,body:JSON.stringify({schema_version:1,action:'usage.record',event}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
      const result=await this.json(response);
      if(response.ok&&result.status==='accepted'&&result.event_id===row.event_id){
       await this.store.meta(entry.key,{...row,ack:true,nextAttemptAt:0,accountKey:identity?.accountKey||row.accountKey||null});
      }else if(result.error==='location_proof_expired'){await this.store.meta(entry.key,{...row,proof:null});}
     }catch{/* Independent queue: analytics never changes the training status. */}
    }
    // Keep current opening for anonymous-to-account promotion, and compact receipts.
    for(const entry of rows)if(entry.value?.ack&&entry.key!==this.opening&&/^usage-(open|end|event):/.test(entry.key)){
     if(entry.key.startsWith('usage-end:'))await this.store.meta(entry.key,{ack:true,createdAt:entry.value.createdAt});
     else await this.store.changeMeta(entry.key,()=>undefined);
    }
   }finally{await this.store.releaseLease(this.owner,'usage-lease');}
  }
  start(events=globalThis){this.events=events;this.wake=()=>this.schedule();for(const name of ['online','buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded','arbat:sync-state'])events.addEventListener?.(name,this.wake);this.schedule();}
  stop(){this.stopped=true;clearTimeout(this.timer);for(const name of ['online','buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded','arbat:sync-state'])this.events?.removeEventListener?.(name,this.wake);}
 }
 return {Usage};
});
