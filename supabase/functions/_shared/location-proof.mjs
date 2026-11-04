// Shared only by the trusted Worker and Edge Function. Never shipped to browsers.
export const USAGE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret){if(typeof secret!=='string'||secret.length<32||secret.length>256)throw new Error('usage_disabled');return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signLocation(payload,secret){const text=b64(encoder.encode(JSON.stringify(payload)));return text+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('proof:'+text))));}
export async function locationRateKey(ip,date,secret){return b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('rate:'+date+':'+ip))));}
export async function verifyLocation(proof,secret,now=Date.now()){
 try{
  if(typeof proof!=='string'||proof.length>4096||!/^[-\w]+\.[-\w]{43}$/.test(proof))throw 0;
  const [text,signature]=proof.split('.');
  if(!await crypto.subtle.verify('HMAC',await key(secret),decode(signature),encoder.encode('proof:'+text)))throw 0;
  const p=JSON.parse(new TextDecoder().decode(decode(text)));
  if(!p||Object.keys(p).sort().join(',')!=='approximate,aud,browser_id,city,country,event_id,event_kind,observed_at,rate_key,region,v'||p.v!==1||p.aud!=='arbat-training-usage'||p.approximate!==true
   ||![p.event_id,p.browser_id].every(v=>typeof v==='string'&&USAGE_UUID.test(v))||!['history_open','end_location'].includes(p.event_kind)||!/^[-\w]{43}$/.test(p.rate_key)
   ||![p.city,p.region].every(v=>v===null||typeof v==='string'&&v.length>0&&v.length<=120)||!(p.country===null||/^[A-Z]{2}$/.test(p.country)))throw 0;
  const age=now-Date.parse(p.observed_at);if(!Number.isFinite(age)||age< -60000||age>7*86400000)throw new Error('location_proof_expired');
  return p;
 }catch(error){if(error?.message==='usage_disabled'||error?.message==='location_proof_expired')throw error;throw new Error('location_proof_invalid');}
}
