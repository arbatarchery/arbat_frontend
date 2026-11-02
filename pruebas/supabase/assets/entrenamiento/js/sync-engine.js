(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatSyncEngine=api;})(globalThis,()=>{
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function createTransport({url,publicKey,enabled=false,fetchImpl=globalThis.fetch}={}){
  const call=async(body,identity)=>{
   if(!enabled||!/^https:\/\//.test(url||'')||!publicKey)throw new Error('sync_disabled');
   const headers={'Content-Type':'application/json',apikey:publicKey,Authorization:`Bearer ${identity.supabaseToken||publicKey}`};
   if(identity.buddyToken)headers['x-buddy-access-token']=identity.buddyToken;
   const response=await fetchImpl(`${url.replace(/\/$/,'')}/functions/v1/training-sync`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
   if(!response.ok){const e=new Error([401,403].includes(response.status)?'auth_required':response.status===429?'rate_limited':'server_unavailable');e.retryAfterMs=response.status===429?Math.max(1000,Math.min(300000,(Number(response.headers.get('Retry-After'))||60)*1000)):null;throw e;}
   const raw=await response.text();if(new TextEncoder().encode(raw).length>16384)throw new Error('invalid_response');return JSON.parse(raw);
  };
  return {send:(operation,identity)=>call({schema_version:1,action:'sync',operations:[operation]},identity),sendBatch:(operations,identity)=>call({schema_version:1,action:'sync',operations},identity),claim:identity=>call({schema_version:1,action:'claim'},identity)};
 }
 class Engine{
  constructor({store,transport,identityProvider=async()=>null,enabled=false,navigator=globalThis.navigator,events=globalThis,crypto=globalThis.crypto,
   now=Date.now,random=Math.random,onState=()=>{},setTimer=(...args)=>setTimeout(...args),clearTimer=id=>clearTimeout(id)}={}){
   Object.assign(this,{store,transport,identityProvider,enabled,navigator,events,now,random,onState,setTimer,clearTimer});
   this.owner=crypto?.randomUUID?.();this.running=false;this.timer=null;this.claimed=null;this.stopped=false;
   this.wake=()=>this.schedule(0);this.visible=()=>{if(!globalThis.document||globalThis.document.visibilityState==='visible')this.schedule(0);};
  }
  async emit(state,error=null){const status=await this.store.status();const value={...status,state,error};this.onState(value);return value;}
  start(){if(!this.enabled)return;for(const event of ['online','buddy:auth-state-changed','buddy:auth-ready'])this.events?.addEventListener?.(event,this.wake);this.events?.addEventListener?.('visibilitychange',this.visible);this.schedule(0);}
  stop(){this.stopped=true;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;for(const event of ['online','buddy:auth-state-changed','buddy:auth-ready'])this.events?.removeEventListener?.(event,this.wake);this.events?.removeEventListener?.('visibilitychange',this.visible);}
  schedule(delay=0){if(!this.enabled||this.stopped)return;if(this.timer!==null)this.clearTimer(this.timer);this.timer=this.setTimer(()=>{this.timer=null;this.flush().catch(()=>{this.onState({state:'error',error:'local_storage_unavailable'});});},Math.max(0,delay));}
  async identity(){const value=await this.identityProvider();if(!value||!UUID.test(value.principalId||'')||(!value.supabaseToken&&!(value.buddyVerified&&value.accountKey&&value.buddyToken))||value.accountKey&&!value.buddyToken)return null;
   return {...value,accountKey:value.accountKey?String(value.accountKey):null};}
  async flush(){
   if(this.stopped)return null;
   if(this.running){this.schedule(250);return null;}
   if(!this.enabled)return this.emit('disabled');
   if(this.navigator?.onLine===false)return this.emit('offline');
   this.running=true;
   try{
    const run=()=>this.drain();
    if(this.navigator?.locks?.request)return await this.navigator.locks.request('arbat-training-sync',{ifAvailable:true},lock=>{if(lock)return run();this.schedule(1000);return null;});
    return await run();
   }finally{this.running=false;}
  }
  async defer(key,op,error,permanent=false,minimum=0){
   const pending=(await this.store.readAll('operations')).find(o=>o.operation_id===op.operation_id);
   const delay=Math.max(minimum,Math.min(60000,1000*2**Math.min(pending?.attempts||0,6))*(.75+this.random()*.5));
   await this.store.fail(key,op.operation_id,error,{permanent,delayMs:delay});if(!permanent)this.schedule(delay);
  }
  async drain(){
   if(!this.owner)return null;
   if(!await this.store.acquireLease(this.owner)){this.schedule(1000);return this.emit('pending');}
   let sent=0,identity;
   try{
    identity=await this.identity();if(!identity){const status=await this.store.status();return await this.emit(status.pending?'auth_required':status.lastConfirmedAt?'synced':'idle');}
    const signature=`${identity.principalId}:${identity.accountKey||''}`;
    const records=(await this.store.readAll('sessions')).sort((a,b)=>Number(Boolean(a.snapshot?.endedAt))-Number(Boolean(b.snapshot?.endedAt))||a.priority-b.priority||a.capturedAt-b.capturedAt);
    const eligible=records.filter(r=>!r.issue&&(!r.accountKey||r.accountKey===identity.accountKey)&&(!r.principalId||r.principalId===identity.principalId));
    if(identity.accountKey&&this.claimed!==signature&&eligible.length){
     await this.emit('syncing');const result=await this.transport.claim(identity);
     if(result?.status!=='accepted'){if(result?.status==='rate_limited')this.schedule(60000);return await this.emit('error',result?.status||'claim_failed');}
     await this.store.assignAccount(eligible.map(r=>r.key),identity.principalId,identity.accountKey);
     this.claimed=signature;
    }
    const deadline=this.now()+15000;
    for(const record of eligible){
     while(sent<32&&this.now()<deadline&&!this.stopped){
      const current=await this.identity();if(!current||`${current.principalId}:${current.accountKey||''}`!==signature){
       if(current&&current.accountKey===identity.accountKey){this.schedule(0);return await this.emit('pending');}
       return await this.emit('auth_required');
      }
      if(this.navigator?.onLine===false)return await this.emit('offline');
      if(!await this.store.acquireLease(this.owner))return null;
      const batch=await this.store.prepareBatch(record.key,current,{limit:this.transport.sendBatch?32-sent:1});if(!batch.length)break;
      await this.emit('syncing');
      let response;
      try{response=this.transport.sendBatch?await this.transport.sendBatch(batch,current):await this.transport.send(batch[0],current);}catch(error){
       await this.defer(record.key,batch[0],error.message==='auth_required'?'auth_required':'network_error',false,error.retryAfterMs||0);
       return await this.emit(error.message==='auth_required'?'auth_required':'pending',error.message==='auth_required'?'auth_required':'network_error');
      }
      // Apply only a contiguous confirmed prefix. Frozen envelopes for the tail
      // remain queued, including when the server committed but its reply was lost.
      for(const [index,op] of batch.entries()){
       const result=response?.results?.[index];
       if(result?.operation_id!==op.operation_id){await this.defer(record.key,op,'invalid_response');return await this.emit('pending','invalid_response');}
       if(result.status==='accepted'){
        try{await this.store.acknowledge(record.key,op.operation_id,result);}catch{await this.defer(record.key,op,'invalid_ack');return await this.emit('error','invalid_ack');}sent++;
       }else{
        const code=result.status||'invalid_response';const permanent=['conflict','rejected','quota_exceeded'].includes(code);
        await this.defer(record.key,op,code,permanent,code==='rate_limited'?60000:0);
        return await this.emit(permanent?'error':'pending',code);
       }
      }
     }
    }
    const status=await this.store.status();
    if(status.pending&&sent)this.schedule(0);
    else if(status.pending){const future=(await this.store.readAll('operations')).filter(o=>o.state!=='blocked'&&o.nextAttemptAt>this.now()).map(o=>o.nextAttemptAt);if(future.length)this.schedule(Math.min(...future)-this.now());}
    return await this.emit(status.issues.length||status.blocked?'error':status.pending?'pending':status.lastConfirmedAt?'synced':'idle');
   }catch(error){
    if(['captcha_required','auth_configuration_required','auth_recovery_required','principal_changed','buddy_auth_required','auth_changed'].includes(error?.code))return await this.emit('auth_required',error.code);
    this.schedule(5000);return await this.emit('error','sync_unavailable');
   }finally{await this.store.releaseLease(this.owner);}
  }
 }
 return {Engine,createTransport};
});
