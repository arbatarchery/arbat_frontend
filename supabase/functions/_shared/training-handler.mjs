import {verifyLocation,USAGE_UUID} from './location-proof.mjs';
import { resolveBuddyPrincipal } from './buddy-principal.mjs';
import { verifyBuddyAccessToken, BuddyIdentityError } from './buddy-identity.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9._~-]+$/;
const KINDS = new Set(['session.upsert','session.close','end.upsert','arrow.upsert','arrow.delete']);
class HttpError extends Error {
  constructor(status, code) { super(code); this.status=status; this.code=code; }
}

async function readJsonLimited(body, limit, timeoutMs=5000) {
  if (!body) throw new HttpError(400,'invalid_json');
  const reader=body.getReader(); let timer;
  try {
    return await Promise.race([
      (async () => {
        const chunks=[]; let length=0;
        while (true) {
          const {done,value}=await reader.read(); if(done) break;
          length+=value.byteLength;
          if(length>limit) throw new HttpError(413,'payload_too_large');
          chunks.push(value);
        }
        const bytes=new Uint8Array(length); let offset=0;
        for(const value of chunks) {bytes.set(value,offset); offset+=value.byteLength;}
        try{return JSON.parse(new TextDecoder().decode(bytes));} catch{throw new HttpError(400,'invalid_json');}
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new HttpError(408,'read_timeout')),timeoutMs);})
    ]);
  } finally {
    clearTimeout(timer);
    // Do not wait for a malicious/slow sender to acknowledge cancellation.
    reader.cancel().catch(()=>{});
  }
}
function validateOperation(op) {
  if(!op || Array.isArray(op) || typeof op!=='object' || Object.keys(op).some(k=>!['operation_id','session_id','entity_id','kind','base_revision','payload'].includes(k))
    || ![op.operation_id,op.session_id,op.entity_id].every(x=>typeof x==='string'&&UUID.test(x))
    || !KINDS.has(op.kind) || !Number.isSafeInteger(op.base_revision) || op.base_revision<0
    || !op.payload || Array.isArray(op.payload) || typeof op.payload!=='object'
    || new TextEncoder().encode(JSON.stringify(op)).length>32768) throw new HttpError(400,'invalid_operation');
}

// Only this server handler derives p_principal and p_buddy_subject. Never accept
// them (or an owner_id) as request parameters. SQL RPCs are service_role-only.
export function createTrainingHandler({url, publicKey, serverKey, allowedOrigins=[], enabled=false, locationSigningSecret, fetchImpl=globalThis.fetch, timeoutMs=5000}={}) {
  const origins=new Set(allowedOrigins);
  return async request => {
    const origin=request.headers.get('origin');
    const cors=origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-buddy-access-token',
      'Access-Control-Allow-Methods':'POST, OPTIONS'}:{'Vary':'Origin'};
    const reply=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{...cors,...extra,'Content-Type':'application/json','Cache-Control':'no-store'}});
    try {
      if(!enabled || !url || !publicKey || !serverKey || !url.startsWith('https://')) throw new HttpError(503,'sync_disabled');
      if(!origins.has(origin)) throw new HttpError(403,'origin_denied');
      if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
      if(request.method!=='POST') throw new HttpError(405,'method_not_allowed');
      if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415,'json_required');
      const bearer=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
      if(!bearer || bearer.length>8192) throw new HttpError(401,'supabase_session_required');
      const body=await readJsonLimited(request.body,131072,timeoutMs);
      if(!body || Array.isArray(body) || body.schema_version!==1 || !['sync','claim','history.list','history.detail','history.context','history.coach','buddy.session','usage.record','usage.summary','system.status'].includes(body.action)) throw new HttpError(400,'invalid_request');
      const keys=body.action==='usage.record'?['schema_version','action','event']:body.action==='usage.summary'?['schema_version','action','from','to']:body.action==='history.coach'?['schema_version','action','from','to','cursor','scope_hash']:body.action==='sync'?['schema_version','action','operations']:body.action==='history.list'?['schema_version','action','from','to','cursor','target_subject']:body.action==='history.detail'?['schema_version','action','session_id','revision','collection','cursor']:['schema_version','action'];
      if(Object.keys(body).some(k=>!keys.includes(k))) throw new HttpError(400,'unknown_request_fields');
      if(body.action==='sync') {
        if(!Array.isArray(body.operations)||!body.operations.length||body.operations.length>32) throw new HttpError(400,'invalid_batch');
        body.operations.forEach(validateOperation);
        if(body.operations.some(op=>op.session_id!==body.operations[0].session_id))throw new HttpError(400,'invalid_batch_sessions');
      }
      if(['history.list','history.coach','usage.summary'].includes(body.action)&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(body.to||'')||body.target_subject!=null&&(typeof body.target_subject!=='string'||!body.target_subject.trim()||body.target_subject.length>256)))throw new HttpError(400,'invalid_history_range');
      if(body.action.startsWith('history.')&&body.cursor!=null&&(typeof body.cursor!=='string'||!UUID.test(body.cursor)))throw new HttpError(400,'invalid_cursor');
      if(body.action==='history.detail'&&(!UUID.test(body.session_id||'')||!Number.isSafeInteger(body.revision)||body.revision<1||!['ends','arrows'].includes(body.collection)))throw new HttpError(400,'invalid_history_detail');
      if(body.action==='history.coach'&&body.scope_hash!=null&&(typeof body.scope_hash!=='string'||!/^[a-f0-9]{32}$/.test(body.scope_hash)))throw new HttpError(400,'invalid_scope');
      const rpc=async(name,args,maxBytes=16384)=>{
        const headers={apikey:serverKey,'Content-Type':'application/json'};
        // Modern secret keys authenticate via apikey; legacy JWT server keys also
        // use Authorization. Never forward either user token to this admin call.
        if(serverKey.startsWith('eyJ')) headers.Authorization=`Bearer ${serverKey}`;
        const response=await fetchImpl(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),redirect:'error',
          signal:AbortSignal.timeout(timeoutMs)});
        const result=await readJsonLimited(response.body,maxBytes,timeoutMs);
        if(!response.ok) {
          const status=result?.code==='28000'?401:result?.code==='42501'?403:/^(22|23)/.test(result?.code)?422:503;
          throw new HttpError(status,status===401?'claim_or_buddy_required':status===403?'not_owner':status===422?'operation_rejected':'server_unavailable');
        }
        if(name==='training_apply_batch'){if(!Array.isArray(result?.results)||result.results.length!==args.p_operations.length)throw new HttpError(503,'invalid_server_result');return result;}
        if(!['accepted','conflict','rate_limited','quota_exceeded','changed','gone','session_pending'].includes(result?.status)) throw new HttpError(503,'invalid_server_result');
        return result;
      };
      let usageEvent=null,location=null;
      if(body.action==='usage.record'){
        const e=body.event;
        if(!e||Array.isArray(e)||typeof e!=='object'||Object.keys(e).some(k=>!['event_id','browser_id','kind','occurred_at','session_id','end_id','proof'].includes(k))
          ||![e.event_id,e.browser_id].every(v=>typeof v==='string'&&USAGE_UUID.test(v))||!['history_open','end_location'].includes(e.kind)
          ||typeof e.occurred_at!=='string'||!Number.isFinite(Date.parse(e.occurred_at))
          ||e.kind==='end_location'&&![e.session_id,e.end_id].every(v=>typeof v==='string'&&USAGE_UUID.test(v))
          ||e.kind==='history_open'&&(e.session_id!=null||e.end_id!=null))throw new HttpError(400,'invalid_usage_event');
        try{location=await verifyLocation(e.proof,locationSigningSecret);}catch(error){throw new HttpError(error.message==='usage_disabled'?503:400,error.message);}
        if(location.event_id!==e.event_id||location.browser_id!==e.browser_id||location.event_kind!==e.kind)throw new HttpError(400,'location_event_mismatch');
        usageEvent={event_id:e.event_id,browser_id:e.browser_id,kind:e.kind,occurred_at:e.occurred_at,session_id:e.session_id??null,end_id:e.end_id??null,
          observed_at:location.observed_at,city:location.city,region:location.region,country:location.country};
      }
      const buddyToken=request.headers.get('x-buddy-access-token');
      if(buddyToken!==null && (!TOKEN.test(buddyToken)||buddyToken.length>8192)) throw new HttpError(401,'buddy_session_unverified');
      let identity=null,user;
      if(bearer===publicKey){
        if(!buddyToken){
          if(usageEvent?.kind==='history_open'){
            const result=await rpc('training_record_usage',{p_principal:null,p_buddy_subject:null,p_event:usageEvent,p_rate_key:location.rate_key});
            return reply(result.status==='rate_limited'?429:200,result);
          }
          throw new HttpError(401,'buddy_session_required');
        }
        identity=await verifyBuddyAccessToken(buddyToken,{fetchImpl,timeoutMs,includeProfile:true});
        const id=await resolveBuddyPrincipal(identity.subject,{url,serverKey,fetchImpl,readJson:readJsonLimited,timeoutMs});
        if(!UUID.test(id||''))throw new HttpError(503,'buddy_bridge_unavailable');
        user={id};
      }else{
        // Existing anonymous envelopes retain their original verified principal.
        const auth=await fetchImpl(`${url}/auth/v1/user`,{method:'GET',headers:{apikey:publicKey,Authorization:`Bearer ${bearer}`},
          redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
        if(!auth.ok) throw new HttpError(auth.status>=500?503:401,'supabase_session_unverified');
        user=await readJsonLimited(auth.body,16384,timeoutMs);
        if(typeof user?.id!=='string'||!UUID.test(user.id)) throw new HttpError(401,'supabase_session_unverified');
        identity=buddyToken?await verifyBuddyAccessToken(buddyToken,{fetchImpl,timeoutMs,includeProfile:true}):null;
      }
      if(usageEvent){const result=await rpc('training_record_usage',{p_principal:user.id,p_buddy_subject:identity?.subject??null,p_event:usageEvent,p_rate_key:location.rate_key});return reply(result.status==='rate_limited'?429:200,result);}
      if(body.action==='usage.summary'){const result=await rpc('training_usage_summary',{p_principal:user.id,p_buddy_subject:identity?.subject??null,p_from:body.from,p_to:body.to},1048576);return reply(result.status==='rate_limited'?429:200,result);}
      if(body.action==='system.status'){const result=await rpc('training_system_status',{p_principal:user.id,p_buddy_subject:identity?.subject??null});return reply(result.status==='rate_limited'?429:200,result);}
      if(body.action==='buddy.session'){
        if(!identity)throw new HttpError(401,'buddy_session_required');
        return reply(200,{status:'accepted',principal_id:user.id,subject:identity.subject});
      }
      if(body.action==='claim'&&!identity) throw new HttpError(401,'buddy_session_required');
      if(body.action.startsWith('history.')){
        if(body.action==='history.context'){
          const result=await rpc('training_history_context',{p_principal:user.id,p_buddy_subject:identity?.subject??null,p_display_name:identity?.displayName??null,p_verified_email:identity?.verifiedEmail??null});
          return reply(result.status==='rate_limited'?429:200,result);
        }
        if(body.action==='history.coach'){
          const result=await rpc('training_coach_overview',{p_principal:user.id,p_buddy_subject:identity?.subject??null,p_from:body.from,p_to:body.to,p_after:body.cursor??null,p_scope_hash:body.scope_hash??null},1048576);
          return reply(result.status==='rate_limited'?429:200,result);
        }
        const args={p_principal:user.id,p_buddy_subject:identity?.subject??null,p_after:body.cursor??null};
        const result=body.action==='history.list'
          ?await rpc('training_history_list',{...args,p_from:body.from,p_to:body.to,p_target_subject:body.target_subject??null},1048576)
          :await rpc('training_history_detail',{...args,p_session:body.session_id,p_revision:body.revision,p_collection:body.collection},1048576);
        return reply(result.status==='rate_limited'?429:200,result,result.status==='rate_limited'?{'Retry-After':'60'}:{});
      }
      if(body.action==='claim') {
        // Both live credentials were verified in this request. Generate only a
        // non-secret receipt hash; raw credentials are never stored in the DB.
        const proof=crypto.randomUUID();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof))),b=>b.toString(16).padStart(2,'0')).join('');
        const result=await rpc('training_claim',{p_principal:user.id,p_buddy_subject:identity.subject,p_proof_hash:hash});
        // Metadata registration must never discard a committed claim receipt.
        if(result.status==='accepted')try{await rpc('training_history_context',{p_principal:user.id,p_buddy_subject:identity.subject,p_display_name:identity.displayName??null,p_verified_email:identity.verifiedEmail??null});}catch{}
        return reply(result.status==='rate_limited'?429:200,result,result.status==='rate_limited'?{'Retry-After':'60'}:{});
      }
      if(body.operations.length>1){
        return reply(200,await rpc('training_apply_batch',{p_principal:user.id,p_buddy_subject:identity?.subject??null,p_operations:body.operations}));
      }
      const results=[]; let stopped=false;
      for(const op of body.operations) {
        if(stopped) {results.push({operation_id:op.operation_id,status:'not_attempted'});continue;}
        try {
          const result=await rpc('training_apply_operation',{p_principal:user.id,p_buddy_subject:identity?.subject??null,p_operation:op});
          results.push({operation_id:op.operation_id,...result});
          stopped=result.status!=='accepted';
        } catch(error) {
          if(!(error instanceof HttpError)) throw error;
          if([401,403,503].includes(error.status)) {
            // Keep previously committed ACKs even if a later call fails.
            results.push({operation_id:op.operation_id,status:'retry_or_auth_required',code:error.code});
          } else results.push({operation_id:op.operation_id,status:'rejected',code:error.code});
          stopped=true;
        }
      }
      return reply(200,{results});
    } catch(error) {
      if(error instanceof BuddyIdentityError) return reply(401,{error:'buddy_session_unverified'});
      if(error instanceof HttpError) return reply(error.status,{error:error.code});
      return reply(503,{error:'server_unavailable'});
    }
  };
}
