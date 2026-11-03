import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {Reader,merge}=createRequire(import.meta.url)('../../entrenamiento/js/sync-history.js');
const id='d0000000-0000-4000-8000-000000000001',identity={principalId:id,supabaseToken:'test-only',accountKey:'buddy-A',buddyToken:'test-buddy'};
const metadata={id,date:'2026-11-01',revision:3,notes:'cloud'};
function reader(fetchImpl,options={}){return new Reader({enabled:true,url:'https://test.supabase.co',publicKey:'public-test',identityProvider:async()=>identity,transport:{claim:async()=>({status:'accepted'})},fetchImpl,...options});}
const get=api=>api.get({from:'2026-11-01',to:'2026-11-30'});
const response=(body,headers={})=>{
 if(body.action==='history.list')return Response.json({status:'accepted',sessions:[metadata],next_cursor:null});
 return Response.json({status:'accepted',revision:3,items:body.collection==='ends'?[{id:'end',ordinal:1,notes:'original'}]:[{id:'arrow',end_id:'end',ordinal:1,label:'9',score:9,x:null,y:null,recorded_at:null}],next_cursor:null},headers);
};
test('remote reader verifies identity, collects pages and preserves original arrow metadata',async()=>{
 const requests=[];const api=reader(async(_url,init)=>{const body=JSON.parse(init.body);requests.push(body);assert.equal(init.headers['x-buddy-access-token'],'test-buddy');return response(body);});
 const result=await get(api);assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].completed[0].arrows[0].recordedAt,null);assert.equal(result.sessions[0].completed[0].notes,'original');assert.equal(requests.length,3);
 await get(api);assert.equal(requests.length,4); // metadata refreshed, completed immutable revision reused
});
test('large-session progress survives rate limits and resumes from the saved UUID cursor',async()=>{
 let limited=true;const seen=[];const api=reader(async(_url,init)=>{const b=JSON.parse(init.body);seen.push(b);
  if(b.action==='history.list')return Response.json({status:'accepted',sessions:[metadata],next_cursor:null});
  if(b.collection==='ends')return Response.json({status:'accepted',revision:3,items:[],next_cursor:null});
  if(!b.cursor)return Response.json({status:'accepted',revision:3,items:[{id:'a',end_id:null,ordinal:1,label:'9',score:9}],next_cursor:'cursor-A'});
  if(limited){limited=false;return Response.json({status:'rate_limited'},{status:429});}
  return Response.json({status:'accepted',revision:3,items:[{id:'b',end_id:null,ordinal:2,label:'8',score:8}],next_cursor:null});
 });
 await assert.rejects(get(api),e=>e.code==='rate_limited');const result=await get(api);assert.equal(result.sessions[0].current.length,2);
 assert.equal(seen.filter(b=>b.collection==='arrows'&&!b.cursor).length,1);
});
test('changed server revision cannot combine a stale index with new arrow pages',async()=>{
 const api=reader(async(_url,init)=>{const b=JSON.parse(init.body);return b.action==='history.list'?response(b):Response.json({status:'changed',revision:4});});
 await assert.rejects(get(api),e=>e.code==='history_changed');
});
test('changing account stops the request before transmitting with another account identity',async()=>{
 let calls=0;const api=reader(async()=>assert.fail('must not fetch'),{identityProvider:async()=>++calls===1?identity:{...identity,accountKey:'buddy-B'}});
 await assert.rejects(get(api),e=>e.code==='auth_changed');
});
test('UUID merge retains pending local versions and never combines sessions merely by date',()=>{
 const local={id:'legacy-a',date:'2026-11-01',notes:'local pending'},cloud={...metadata};
 const map={key:id,snapshot:local,pending:1,confirmedRevision:2};
 assert.deepEqual(merge([local],{sessions:[cloud],deletedIds:[]},[map]),[local]);
 assert.deepEqual(merge([local],{sessions:[cloud],deletedIds:[]},[{...map,pending:0}]),[cloud]);
 assert.equal(merge([{...local,id:'other'}],{sessions:[cloud],deletedIds:[]},[map]).length,2);
 assert.equal(merge([local],{sessions:[],deletedIds:[id]},[{...map,pending:0}]).length,0);
 assert.equal(merge([local],{sessions:[],deletedIds:[id]},[map]).length,1);
});
test('ID-less local records keep multiplicity using persisted mappings',()=>{
 const local={date:'2026-11-01',arrows:[]},a={key:'a',snapshot:local,normalized:local,pending:0,confirmedRevision:1},b={...a,key:'b'};
 const remote={sessions:[{...local,id:'a',revision:1},{...local,id:'b',revision:1}],deletedIds:[]};
 assert.equal(merge([local,{...local}],remote,[a,b]).length,2);
});

test('remote reader invokes fetch without a Reader receiver, as required by browser fetch',async()=>{
 const api=reader(async function(_url,init){assert.equal(this,undefined);return response(JSON.parse(init.body));});
 assert.equal((await get(api)).sessions.length,1);
});

test('history failures identify the failed operation without exposing server response bodies',async()=>{
 const api=reader(async(_url,init)=>{const body=JSON.parse(init.body);return body.action==='history.list'?response(body):Response.json({error:'private-token-and-session-data'},{status:503});});
 await assert.rejects(get(api),e=>e.code==='history_unavailable'&&e.httpStatus===503&&e.historyAction==='history.detail'&&e.historyCollection==='ends'&&!e.message.includes('private-token'));
});
test('invalid history JSON has a distinct safe diagnosis',async()=>{
 const api=reader(async()=>new Response('not JSON: private-token'));
 await assert.rejects(get(api),e=>e.code==='history_invalid_json'&&e.historyAction==='history.list'&&!e.message.includes('private-token'));
});

test('history reports real partial arrow pages and counts cached revisions once',async()=>{
 const progress=[];const api=reader(async(_url,init)=>{const b=JSON.parse(init.body);
  if(b.action==='history.list')return Response.json({status:'accepted',sessions:[metadata],next_cursor:null});
  if(b.collection==='ends')return Response.json({status:'accepted',revision:3,items:[{id:'end',ordinal:1}],next_cursor:null});
  return Response.json({status:'accepted',revision:3,items:b.cursor?[{id:'b',end_id:'end',ordinal:2}]:[{id:'a',end_id:'end',ordinal:1}],next_cursor:b.cursor?null:'cursor-A'});
 });
 const options={from:'2026-11-01',to:'2026-11-30',onProgress:(_count,details)=>progress.push(details)};
 await api.get(options);assert.ok(progress.some(p=>p.sessions===0&&p.arrows===1));assert.deepEqual(progress.at(-1),{sessions:1,ends:1,arrows:2});
 assert.ok(progress.every((p,i)=>!i||p.arrows>=progress[i-1].arrows));
 progress.length=0;await api.get(options);assert.deepEqual(progress.at(-1),{sessions:1,ends:1,arrows:2});
});

const pause=(ms,signal)=>new Promise((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Aborted','AbortError'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
});
const many=Array.from({length:8},(_,i)=>({...metadata,id:`e0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
test('parallel history caps requests at three, preserves order and reuses only freshly authorized revisions',async()=>{
 let active=0,peak=0,calls=0,allowed=true;const revisions=new Map(many.map(m=>[m.id,3])),progress=[];
 const api=reader(async(_url,init)=>{
  calls++;const b=JSON.parse(init.body);active++;peak=Math.max(peak,active);
  try{
   await pause(b.session_id===many[0].id?8:2,init.signal);
   if(b.action==='history.list')return Response.json({status:'accepted',sessions:!allowed||b.cursor?[]:many.map(m=>({...m,revision:revisions.get(m.id)})),next_cursor:allowed&&!b.cursor?many.at(-1).id:null});
   return Response.json({status:'accepted',revision:revisions.get(b.session_id),items:b.collection==='ends'?[{id:'end:'+b.session_id,ordinal:1}]:[{id:'arrow:'+b.session_id,end_id:'end:'+b.session_id,ordinal:1,label:'9',score:9}],next_cursor:null});
  }finally{active--;}
 });
 const options={from:'2026-11-01',to:'2026-11-30',onProgress:(_n,p)=>progress.push(p)};
 const first=await api.get(options);assert.deepEqual(first.sessions.map(s=>s.id),many.map(m=>m.id));assert.equal(peak,3);assert.equal(calls,18);
 assert.deepEqual(progress.at(-1),{sessions:8,ends:8,arrows:8});assert.ok(progress.every((p,i)=>!i||p.arrows>=progress[i-1].arrows));
 const before=calls;await api.get(options);assert.equal(calls-before,2); // fresh index pages, zero unchanged details
 revisions.set(many[0].id,4);const changed=calls;await api.get(options);assert.equal(calls-changed,4); // only one changed session is downloaded
 allowed=false;const denied=calls;assert.equal((await api.get(options)).sessions.length,0);assert.equal(calls-denied,1); // cached private rows are not returned
});
test('parallel context and history share a single account claim',async()=>{
 let claims=0,release;
 const api=reader(async(_url,init)=>{const b=JSON.parse(init.body);return b.action==='history.context'?Response.json({status:'accepted',role:'user'}):response(b);},{transport:{claim:()=>{claims++;return new Promise(resolve=>{release=resolve;});}}});
 const jobs=[api.context(),get(api)];await new Promise(resolve=>setImmediate(resolve));assert.equal(claims,1);release({status:'accepted'});
 await Promise.all(jobs);assert.equal(claims,1);
});
test('a failed parallel load joins aborted siblings before retrying partial cached pages',async()=>{
 let active=0,limited=true;const endCalls=new Map();
 const api=reader(async(_url,init)=>{
  const b=JSON.parse(init.body);if(b.action==='history.list')return Response.json({status:'accepted',sessions:many,next_cursor:null});
  active++;
  try{
   if(b.collection==='ends')endCalls.set(b.session_id,(endCalls.get(b.session_id)||0)+1);
   await pause(b.collection==='ends'?1:b.session_id===many[0].id?5:20,init.signal);
   if(limited&&b.collection==='arrows'&&b.session_id===many[0].id)return Response.json({status:'rate_limited'},{status:429});
   return Response.json({status:'accepted',revision:3,items:b.collection==='ends'?[{id:'end:'+b.session_id,ordinal:1}]:[{id:'arrow:'+b.session_id,end_id:'end:'+b.session_id,ordinal:1}],next_cursor:null});
  }finally{active--;}
 });
 await assert.rejects(get(api),e=>e.code==='rate_limited');assert.equal(active,0);
 limited=false;const result=await get(api);assert.equal(result.sessions.length,8);assert.ok(result.sessions.every(s=>s.completed.length===1&&s.completed[0].arrows.length===1));
 assert.ok([...endCalls.values()].every(count=>count===1));assert.equal(active,0);
});

test('switching away during the final account check cancels a completed parallel result',async()=>{
 const controller=new AbortController();let checks=0;
 const api=reader(async(_url,init)=>response(JSON.parse(init.body)),{identityProvider:async()=>{if(++checks===5)controller.abort();return identity;}});
 await assert.rejects(api.get({from:'2026-11-01',to:'2026-11-30',signal:controller.signal}),e=>e.name==='AbortError');
});
