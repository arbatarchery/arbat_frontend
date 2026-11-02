// Buddy-only requests never mint a browser Supabase credential. Every request
// verifies the live Buddy token before resolving this server-owned principal.
export async function resolveBuddyPrincipal(subject,{url,serverKey,fetchImpl,readJson,timeoutMs=5000}){
 const headers={apikey:serverKey,'Content-Type':'application/json'};
 if(serverKey.startsWith('eyJ'))headers.Authorization=`Bearer ${serverKey}`;
 const call=async(path,body,method='POST')=>{
  const response=await fetchImpl(`${url}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
  const data=await readJson(response.body,16384,timeoutMs);return {ok:response.ok,status:response.status,data};
 };
 const lookup=async()=>{const r=await call('/rest/v1/rpc/training_buddy_lookup',{p_subject:subject});if(!r.ok||r.data.status!=='accepted')throw new Error('buddy_bridge_unavailable');return r.data.principal_id;};
 let id=await lookup();if(id)return id;
 // Stable server-derived UUID limits creation to one bridge principal per Buddy
 // subject, including concurrent first logins. Never use a browser-supplied ID.
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`arbat-buddy-v1:https://api.statetty.com:${subject}`)));
 hash[6]=(hash[6]&15)|128;hash[8]=(hash[8]&63)|128;
 const hex=Array.from(hash.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
 id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 const marker=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
 let user=await call(`/auth/v1/admin/users/${id}`,null,'GET');
 if(user.status===404){
  user=await call('/auth/v1/admin/users',{id,email:`${crypto.randomUUID()}@buddy.arbat.invalid`,password:`${crypto.randomUUID()}Aa1!`,email_confirm:true,app_metadata:{arbat_buddy_bridge:marker}});
  if(!user.ok)user=await call(`/auth/v1/admin/users/${id}`,null,'GET');
 }
 if(!user.ok||user.data.id!==id||user.data.app_metadata?.arbat_buddy_bridge!==marker)throw new Error('buddy_bridge_unavailable');
 await call('/rest/v1/rpc/training_claim',{p_principal:id,p_buddy_subject:subject,p_proof_hash:marker});
 // An anonymous login may have claimed this subject during admin creation.
 // In that case use its canonical owner; never transfer a permanent account.
 const canonical=await lookup();
 if(canonical)return canonical;
 throw new Error('buddy_bridge_unavailable');
}
