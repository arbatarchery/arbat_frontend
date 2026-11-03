import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const {Reader}=createRequire(import.meta.url)('../../entrenamiento/js/sync-history.js');
const id=n=>`f0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const samples=[36,18,6,6,24,18,8,3].map((arrows,i)=>({id:id(i+1),date:'2026-11-02',revision:1,arrows,ends:[6,3,1,2,4,3,1,1][i]}));
const identity={principalId:id(99),accountKey:'fixture',buddyToken:'mock-token',buddyVerified:true};
async function measure(concurrency){
 let calls=0,active=0,peak=0;
 const api=new Reader({enabled:true,url:'https://example.invalid',publicKey:'mock-public',concurrency,identityProvider:async()=>identity,transport:{claim:async()=>({status:'accepted'})},fetchImpl:async(_url,init)=>{
  calls++;active++;peak=Math.max(peak,active);
  try{
   await new Promise(resolve=>setTimeout(resolve,25));const body=JSON.parse(init.body);
   if(body.action==='history.list')return Response.json({status:'accepted',sessions:body.cursor?[]:samples.map(({id,date,revision})=>({id,date,revision})),next_cursor:body.cursor?null:samples.at(-1).id});
   const sample=samples.find(s=>s.id===body.session_id);
   return Response.json({status:'accepted',revision:1,items:body.collection==='ends'?Array.from({length:sample.ends},(_,i)=>({id:id(1000+(samples.indexOf(sample)*10)+i),ordinal:i+1})):Array.from({length:sample.arrows},(_,i)=>({id:id(2000+(samples.indexOf(sample)*100)+i),end_id:id(1000+(samples.indexOf(sample)*10)+(i%sample.ends)),ordinal:i+1,label:'9',score:9})),next_cursor:null});
  }finally{active--;}
 }});
 const start=performance.now();const result=await api.get({from:'2026-11-01',to:'2026-11-30'});const ms=Math.round(performance.now()-start);
 const coldCalls=calls;await api.get({from:'2026-11-01',to:'2026-11-30'});
 return {result,ms,coldCalls,repeatCalls:calls-coldCalls,peak};
}
const serial=await measure(1),parallel=await measure(3);assert.deepEqual(parallel.result,serial.result);
assert.equal(parallel.coldCalls,18);assert.equal(parallel.repeatCalls,2);assert.equal(parallel.peak,3);
console.log(JSON.stringify({fixture:'8 sesiones, 21 andanadas, 119 flechas; 25 ms simulados por petición',sequential_ms:serial.ms,parallel_ms:parallel.ms,speedup:Number((serial.ms/parallel.ms).toFixed(2)),requests_first_load:parallel.coldCalls,requests_revisit:parallel.repeatCalls,identical_data:true}));
