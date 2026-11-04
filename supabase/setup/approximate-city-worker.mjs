// ARBAT — detección de ciudad aproximada para Cloudflare Workers.
// Pegar completo en el editor del Worker. Configurar TRAINING_LOCATION_SIGNING_SECRET como Secret.
// El archivo generado incluye las funciones de firma; no necesita librerías ni conexión a Supabase.
// No registra IP, coordenadas, nombres, cookies ni credenciales en la aplicación.
// Shared only by the trusted Worker and Edge Function. Never shipped to browsers.
const USAGE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret){if(typeof secret!=='string'||secret.length<32||secret.length>256)throw new Error('usage_disabled');return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function signLocation(payload,secret){const text=b64(encoder.encode(JSON.stringify(payload)));return text+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('proof:'+text))));}
async function locationRateKey(ip,date,secret){return b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('rate:'+date+':'+ip))));}
async function verifyLocation(proof,secret,now=Date.now()){
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

const ALLOWED_ORIGINS = new Set(['https://arbatarchery.com', 'http://localhost:8000']);
const label = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;

export default {
  async fetch(request, env={}) {
    const origin = request.headers.get('Origin');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {})
    };
    const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) return reply(403, { error: 'origin_denied' });
    if (new URL(request.url).pathname !== '/') return reply(404, { error: 'not_found' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return reply(405, { error: 'method_not_allowed' }, { Allow: 'GET, OPTIONS' });
    // Use Cloudflare's metadata for THIS incoming request, never a client-provided IP,
    // geographic header, query parameter or request body. Preview may have no cf object.
    const city = label(request.cf?.city);
    const rawCountry = label(request.cf?.country);
    const country = rawCountry && /^[A-Z]{2}$/.test(rawCountry) && rawCountry !== 'XX' ? rawCountry : null;
    const result = {
      schema_version: 1,
      available: Boolean(city),
      source: 'cloudflare-ip',
      approximate: true,
      city,
      region: label(request.cf?.region),
      country
    };
    const query=new URL(request.url).searchParams;
    if(query.has('event_id')){
      const event_id=query.get('event_id'),browser_id=query.get('browser_id'),event_kind=query.get('event_kind');
      if(![event_id,browser_id].every(v=>USAGE_UUID.test(v||''))||!['history_open','end_location'].includes(event_kind))return reply(400,{error:'invalid_event'});
      if(!env.TRAINING_LOCATION_SIGNING_SECRET)return reply(503,{error:'usage_disabled'});
      const observed_at=new Date().toISOString();
      // Cloudflare overwrites this header at its edge. Never accept an IP parameter.
      const ip=request.headers.get('cf-connecting-ip');
      if(!ip)return reply(503,{error:'location_unavailable'});
      try{
       const rate_key=await locationRateKey(ip,observed_at.slice(0,10),env.TRAINING_LOCATION_SIGNING_SECRET);
       result.proof=await signLocation({v:1,aud:'arbat-training-usage',event_id,browser_id,event_kind,observed_at,rate_key,city,region:result.region,country,approximate:true},env.TRAINING_LOCATION_SIGNING_SECRET);
       result.observed_at=observed_at;
      }catch{return reply(503,{error:'usage_disabled'});}
    }
    return reply(200,result);
  }
};
