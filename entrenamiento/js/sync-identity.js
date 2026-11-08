(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatSyncIdentity=api;})(globalThis,()=>{
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const failure=code=>Object.assign(new Error(code),{code});
 class Identity{
  constructor({store,enabled=false,url,publicKey,getBuddy=()=>({accountKey:null,buddyToken:null}),captchaProvider=async()=>null,
   sdkLoader=()=>import('./lib/auth-client.mjs'),fetchImpl=globalThis.fetch,crypto=globalThis.crypto,navigator=globalThis.navigator,now=Date.now}={}){
   Object.assign(this,{store,enabled,url,publicKey,getBuddy,captchaProvider,sdkLoader,fetchImpl,crypto,navigator,now});this.clients=new Map();this.inflight=null;
   this.fetchImpl=(...args)=>fetchImpl(...args);
   this.registryKey=`auth-registry:${url||'disabled'}`;
  }
  async bucketLock(bucket,work,timeout=10000){
   const key=`auth-lock:${this.url}:${bucket}`;
   if(this.navigator?.locks?.request)return this.navigator.locks.request(key,work);
   const owner=this.crypto.randomUUID(),until=this.now()+Math.max(1000,Math.min(timeout<0?10000:timeout,10000));
   while(!await this.store.acquireLease(owner,30000,key)){
    if(this.now()>=until)throw failure('auth_busy');await new Promise(r=>setTimeout(r,50));
   }
   let lost=false;const renewal=setInterval(()=>{this.store.acquireLease(owner,30000,key).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;});},5000);
   try{const value=await work();if(lost)throw failure('auth_busy');return value;}finally{clearInterval(renewal);await this.store.releaseLease(owner,key);}
  }
  async client(bucket){
   if(this.clients.has(bucket))return this.clients.get(bucket);
   const {GoTrueClient}=await this.sdkLoader();
   const credentialKey=key=>`auth-credential:${this.url}:${bucket}:${key}`;
   const client=new GoTrueClient({url:`${this.url.replace(/\/$/,'')}/auth/v1`,headers:{apikey:this.publicKey},
    storageKey:`arbat-training:${new URL(this.url).hostname}:${bucket}`,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,debug:false,
    storage:{getItem:key=>this.store.meta(credentialKey(key)),setItem:(key,value)=>this.store.meta(credentialKey(key),value),removeItem:key=>this.store.changeMeta(credentialKey(key),()=>undefined)},
    fetch:(url,options={})=>this.fetchImpl(url,{...options,signal:AbortSignal.timeout(10000),redirect:'error'})});
   this.clients.set(bucket,client);return client;
  }
  async identity({forHistory=false}={}){
   if(!this.enabled)return null;
   if(this.inflight){
    const pending=this.inflight,retryForHistory=forHistory&&!this.inflightForHistory;
    const result=await pending;
    return result||!retryForHistory?result:this.identity({forHistory:true});
   }
   this.inflightForHistory=forHistory;
   const pending=this.resolve(forHistory).finally(()=>{if(this.inflight===pending)this.inflight=null;});
   this.inflight=pending;return pending;
  }
  async resolve(forHistory=false){
   if(!/^https:\/\//.test(this.url||'')||!this.publicKey)throw failure('auth_configuration_required');
   const buddy=this.getBuddy();const accountKey=buddy.accountKey?String(buddy.accountKey):null;
   if(accountKey&&!buddy.buddyToken)throw failure('buddy_auth_required');
   const [records,ops]=await Promise.all([this.store.readAll('sessions'),this.store.readAll('operations')]);
   const pending=new Set(ops.filter(o=>o.state!=='blocked'&&o.nextAttemptAt<=this.now()).map(o=>o.sessionKey));
   const eligible=records.filter(r=>pending.has(r.key)&&!r.issue&&(!r.accountKey||r.accountKey===accountKey)).sort((a,b)=>a.priority-b.priority||a.capturedAt-b.capturedAt);
   // A completed upload clears the queue, but the guest principal still owns
   // those sessions until a verified Buddy login claims it.
   const unclaimedPrincipals=new Set(records
    .filter(record=>!record.accountKey&&!record.issue&&record.confirmedRevision>0)
    .map(record=>record.principalId));
   let selected;
   const registry=await this.store.changeMeta(this.registryKey,current=>{
    const value=current||{buckets:[],guest:null};
    const usable=b=>b.accountKey===accountKey||b.accountKey===null;
    if(accountKey)selected=value.buckets.find(bucket=>bucket.principalId&&usable(bucket)&&unclaimedPrincipals.has(bucket.principalId));
    // Preserve the original Supabase principal for queued envelopes and receipts.
    if(!selected){
     for(const record of eligible){
      if(!record.principalId)continue;
      selected=value.buckets.find(bucket=>bucket.principalId===record.principalId&&usable(bucket));
      if(selected)break;
     }
    }
    if(!selected)selected=value.buckets.find(b=>b.accountKey===accountKey&&b.principalId);
    const create=eligible.some(r=>!r.principalId)||(forHistory&&accountKey);
    if(!selected&&create)selected=value.buckets.find(b=>b.key===value.guest&&b.accountKey===null);
    if(!selected&&create){
     selected={key:this.crypto.randomUUID(),accountKey:null,principalId:null};value.buckets.push(selected);value.guest=selected.key;
    }
    if(selected&&accountKey&&selected.accountKey===null){selected.accountKey=accountKey;if(value.guest===selected.key)value.guest=null;}
    return value;
   });
   if(!selected)return null;
   selected=registry.buckets.find(b=>b.key===selected.key);
   return this.bucketLock(selected.key,async()=>{
   if(accountKey&&selected.kind==='buddy'&&selected.principalId){
    return {principalId:selected.principalId,accountKey,buddyToken:buddy.buddyToken,buddyVerified:true};
   }
   if(accountKey&&!selected.principalId){
    const response=await this.fetchImpl(`${this.url.replace(/\/$/,'')}/functions/v1/training-sync`,{method:'POST',headers:{'Content-Type':'application/json',apikey:this.publicKey,Authorization:`Bearer ${this.publicKey}`,'x-buddy-access-token':buddy.buddyToken},body:JSON.stringify({schema_version:1,action:'buddy.session'}),signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
    if(!response.ok)throw failure(response.status===401?'buddy_auth_required':'buddy_bridge_unavailable');
    const raw=await response.text();if(raw.length>16384)throw failure('buddy_bridge_unavailable');const result=JSON.parse(raw);
    if(result.status!=='accepted'||!UUID.test(result.principal_id||'')||String(result.subject)!==accountKey)throw failure('buddy_auth_required');
    const after=this.getBuddy();if(String(after.accountKey)!==accountKey||!after.buddyToken)throw failure('auth_changed');
    if(selected.principalId&&selected.principalId!==result.principal_id)throw failure('principal_changed');
    await this.store.changeMeta(this.registryKey,current=>{const bucket=current.buckets.find(b=>b.key===selected.key);if(!bucket||bucket.accountKey!==accountKey)throw failure('auth_changed');bucket.principalId=result.principal_id;bucket.kind='buddy';return current;});
    return {principalId:result.principal_id,accountKey,buddyToken:after.buddyToken,buddyVerified:true};
   }
   const client=await this.client(selected.key);let {data,error}=await client.getSession();
   if(error)throw failure('auth_recovery_required');let session=data?.session;
   if(!session){
    if(selected.principalId)throw failure('auth_recovery_required');
    const captchaToken=await this.captchaProvider();if(!captchaToken)throw failure('captcha_required');
    const result=await client.signInAnonymously({options:{captchaToken}});
    if(result.error||!result.data?.session){const code=result.error?.code;throw failure(code==='captcha_failed'?'captcha_rejected':code==='over_request_rate_limit'?'anonymous_signin_rate_limited':['anonymous_provider_disabled','signup_disabled'].includes(code)?'anonymous_signin_disabled':'anonymous_signin_failed');}session=result.data.session;
   }
   if(!UUID.test(session.user?.id||'')||!session.access_token)throw failure('auth_recovery_required');
   if(selected.principalId&&selected.principalId!==session.user.id)throw failure('principal_changed');
   const after=this.getBuddy();if((after.accountKey?String(after.accountKey):null)!==accountKey)throw failure('auth_changed');
   await this.store.changeMeta(this.registryKey,current=>{const bucket=current.buckets.find(b=>b.key===selected.key);if(!bucket||bucket.accountKey!==accountKey)throw failure('auth_changed');if(bucket.principalId&&bucket.principalId!==session.user.id)throw failure('principal_changed');bucket.principalId=session.user.id;return current;});
   return {principalId:session.user.id,supabaseToken:session.access_token,accountKey,buddyToken:accountKey?after.buddyToken:null};
   });
  }
  async stop(){for(const client of this.clients.values()){if(client.dispose)await client.dispose();else await client.stopAutoRefresh?.();}}
 }
 return {Identity};
});
