(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatDiagnostics=api;})(globalThis,root=>{
 'use strict';
 const levels={ok:0,unknown:1,warning:2,error:3};
 const services=new Set(['history','identity','city','usage','sync','database','network']);
 const actions=new Set(['history.list','history.all','history.detail','history.context','history.coach','usage.summary','usage.record','system.status','city.lookup','sync']);
 const codes=new Set(['ok','pending','session_pending','rate_limited','quota_exceeded','auth_required','auth_changed','history_unavailable','history_timeout','history_network_error','history_invalid_json','history_response_limit','usage_disabled','city_unavailable','location_unavailable','location_proof_invalid','location_proof_expired','location_event_mismatch','server_unavailable','operation_rejected','invalid_request','not_owner','claim_or_buddy_required','supabase_session_unverified','buddy_session_required','sync_disabled','network_error','local_storage_unavailable','invalid_ack','invalid_response','sync_unavailable','database_read_only','system_status_unavailable','captcha_required','offline','unexpected_error']);
 let latest={},errors=[];
 const worst=states=>states.reduce((a,b)=>levels[b]>levels[a]?b:a,'ok');
 function record(input){
  if(!services.has(input.service))return;
  const code=codes.has(input.code)?input.code:'unexpected_error';
  const status=code==='ok'?'ok':['pending','session_pending','rate_limited','captcha_required'].includes(code)?'warning':'error';
  const row={service:input.service,action:actions.has(input.action)?input.action:'sync',code,status,at:Date.now()};
  if(Number.isInteger(input.http)&&input.http>=100&&input.http<=599)row.http=input.http;
  if(Number.isFinite(input.ms)&&input.ms>=0)row.ms=Math.round(input.ms);
  if(status==='ok'&&row.ms>(row.action==='system.status'?10000:3000))row.status='warning';
  latest[row.service+':'+row.action]=row;
  if(status!=='ok'){errors.unshift(row);errors=errors.slice(0,20);}
  if(root.dispatchEvent&&root.CustomEvent)root.dispatchEvent(new root.CustomEvent('arbat:diagnostic'));
 }
 function snapshot({serverOnly=false}={}){const grouped={};for(const row of Object.values(latest)){if(serverOnly&&!Number.isInteger(row.http))continue;const old=grouped[row.service];if(!old||levels[row.status]>=levels[old.status])grouped[row.service]=row;}return {latest:grouped,errors:[...errors]};}
 return {record,worst,safeCode:value=>codes.has(value)?value:'unexpected_error',snapshot,clear:()=>{latest={};errors=[];}};
});
