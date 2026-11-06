// Server-only read access to fixed Supabase Management API endpoints.
const API='https://api.supabase.com/v1';
const SERVICES=['auth','db','rest','storage','realtime'];
const PROJECT_STATES=new Set(['INACTIVE','ACTIVE_HEALTHY','ACTIVE_UNHEALTHY','COMING_UP','UNKNOWN','GOING_DOWN','INIT_FAILED','REMOVED','RESTORING','UPGRADING','PAUSING','RESTORE_FAILED','RESTARTING','PAUSE_FAILED','RESIZING','PROMOTING']);
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export const capacityLevel=percent=>!Number.isFinite(percent)||percent<0?'unknown':percent>=95?'error':percent>=80?'warning':'ok';
export function normalizeDisk(data,now=Date.now()){
 const m=data?.metrics,at=Date.parse(data?.timestamp);
 if(!m||![m.fs_size_bytes,m.fs_used_bytes,m.fs_avail_bytes].every(nonnegative)||m.fs_size_bytes<=0||m.fs_used_bytes>m.fs_size_bytes||m.fs_avail_bytes>m.fs_size_bytes||!Number.isFinite(at)||at>now+300000)return {status:'unknown',code:'management_invalid_disk'};
 const stale=now-at>3600000,percent=m.fs_used_bytes/m.fs_size_bytes*100;
 return {status:stale?'unknown':capacityLevel(percent),code:stale?'management_stale_disk':'ok',checked_at:new Date(at).toISOString(),total_bytes:m.fs_size_bytes,used_bytes:m.fs_used_bytes,available_bytes:m.fs_avail_bytes,percent};
}
export function createManagementStatus({token,projectRef,fetchImpl=globalThis.fetch,now=()=>Date.now(),timeoutMs=2000}={}){
 const configured=typeof token==='string'&&token.length>0&&/^[a-z]{20}$/.test(projectRef||'');
 const cache=new Map();
 const unknown=code=>({status:'unknown',code});
 async function read(path,normalize){
  const old=cache.get(path);if(old&&old.until>now())return old.promise;
  const entry={until:now()+300000,promise:null};
  entry.promise=(async()=>{try{
   const response=await fetchImpl(API+path,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok){response.body?.cancel().catch(()=>{});entry.until=now()+30000;return {...unknown(response.status===401||response.status===403?'management_access_denied':response.status===429?'management_rate_limited':'management_request_failed'),http:response.status};}
   const reader=response.body?.getReader();if(!reader)throw 0;let size=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw 0;chunks.push(value);}}finally{reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   const data=JSON.parse(new TextDecoder().decode(bytes));return normalize(data);
  }catch{entry.until=now()+30000;return unknown('management_unavailable');}})();cache.set(path,entry);return entry.promise;
 }
 const base=`/projects/${projectRef}`;
 async function disk(){
  if(!configured)return unknown('management_not_configured');
  const value=await read(base+'/config/disk/util',data=>normalizeDisk(data,now()));
  // Recheck source age even while the response is cached.
  return value.checked_at&&now()-Date.parse(value.checked_at)>3600000?{...value,status:'unknown',code:'management_stale_disk'}:value;
 }
 async function capacity(){const d=await disk();return {database_near_limit:['ok','warning','error'].includes(d.status)?d.percent>=95:null,capacity_source:'management_disk'};}
 async function status(){
  if(!configured)return {status:'unknown',code:'management_not_configured',disk:unknown('management_not_configured'),services:[]};
  const [d,allocation,project,health,readonly,autoscale]=await Promise.all([
   disk(),read(base+'/config/disk',v=>nonnegative(v?.attributes?.size_gb)&&v.attributes.size_gb>0?{status:'ok',size_gb:v.attributes.size_gb}:unknown('management_invalid_disk')),
   read(base,v=>({status:PROJECT_STATES.has(v?.status)?v.status:'UNKNOWN',organization:/^[\w-]{1,100}$/.test(v?.organization_slug||'')?v.organization_slug:null})),
   read(base+'/health?services=auth,db,rest,storage,realtime&timeout_ms=1500',v=>({...(Array.isArray(v)?{}:{status:'unknown',code:'management_invalid_health'}),services:SERVICES.map(name=>{const matches=Array.isArray(v)?v.filter(s=>s.name===name):[],s=matches.length===1?matches[0]:null;return {name,status:s?.status==='ACTIVE_HEALTHY'?'ok':s?.status==='COMING_UP'?'warning':s?.status==='UNHEALTHY'?'error':'unknown'};})})),
   read(base+'/readonly',v=>typeof v?.enabled==='boolean'?{status:v.enabled?'error':'ok',enabled:v.enabled}:unknown('management_invalid_readonly')),
   read(base+'/config/disk/autoscale',v=>v&&[v.growth_percent,v.min_increment_gb,v.max_size_gb].every(x=>x===null||nonnegative(x))?{status:'ok',growth_percent:v.growth_percent,min_increment_gb:v.min_increment_gb,max_size_gb:v.max_size_gb}:unknown('management_invalid_autoscale'))
  ]);
  const organization=project.organization?await read('/organizations/'+encodeURIComponent(project.organization),v=>({plan:['free','pro','team','enterprise','platform'].includes(v?.plan)?v.plan:null})):{};
  const problem=[d,allocation,project,health,readonly,autoscale,organization].find(v=>v.code&&v.code!=='ok');
  return {status:problem?'partial':'checked',code:problem?.code,checked_at:new Date(now()).toISOString(),plan:organization.plan||null,disk:d,allocation,
   project:{status:project.status,code:project.code,http:project.http},services:health.services||SERVICES.map(name=>({name,status:'unknown'})),
   readonly,autoscale,monthly_metrics_available:false};
 }
 return {status,capacity};
}
