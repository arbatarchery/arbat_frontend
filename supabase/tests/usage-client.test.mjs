import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {indexedDB} from 'fake-indexeddb';
const require=createRequire(import.meta.url),{Usage}=require('../../entrenamiento/js/sync-usage.js'),{Store}=require('../../entrenamiento/js/sync-store.js');
test('one opening, login promotion, end receipt deduplication and offline retention',async t=>{
 const store=new Store({name:'usage-client-'+crypto.randomUUID(),indexedDB}),sent=[],cities=[];let account=null,online=true;
 const now=Date.now();
 const usage=new Usage({store,url:'https://db.test',publicKey:'public',cityUrl:'https://city.test/',accountProvider:()=>account,identityProvider:async()=>account?{accountKey:account,buddyToken:'verified'}:null,now:()=>now,online:()=>online,fetchImpl:async(url,init)=>{
  if(String(url).startsWith('https://city.test/')){cities.push(url);assert.equal(init.credentials,'omit');assert.equal(init.headers,undefined);return Response.json({proof:'signed-test',observed_at:new Date(now).toISOString()});}
  const body=JSON.parse(init.body);sent.push(body);return Response.json({status:'accepted',event_id:body.event.event_id});
 }});usage.schedule=()=>{};t.after(()=>usage.stop());
 const opening=await usage.openHistory();await usage.openHistory();await usage.flush();assert.equal(sent.length,1);assert.equal(cities.length,1);
 account='account-a';await usage.flush();assert.equal(sent.length,2);assert.equal(sent[0].event.event_id,sent[1].event.event_id);assert.equal(cities.length,1);
 account='account-b';await usage.flush();assert.equal(sent.length,2);
 account='account-a';const record={key:crypto.randomUUID(),projection:{ends:[{id:crypto.randomUUID(),payload:{ended_at:new Date(now).toISOString()}}]}};
 await usage.observe(record);online=false;await usage.flush();assert.equal(sent.length,2);online=true;await usage.flush();assert.equal(sent.length,3);
 await usage.observe(record);await usage.flush();await usage.observe(record);await usage.flush();assert.equal(sent.length,3);
 const stale={key:crypto.randomUUID(),projection:{ends:[{id:crypto.randomUUID(),payload:{ended_at:new Date(now-86400000).toISOString()}}]}};
 await usage.observe(stale);await usage.flush();assert.equal(sent.length,3);
 assert.equal((await store.meta(opening)).accountKey,'account-a');
});
test('browser fetch retains the Window receiver for city and event requests',async t=>{
 const store=new Store({name:'usage-fetch-receiver-'+crypto.randomUUID(),indexedDB});
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async function(url,init){
  assert.equal(this,globalThis,'native browser fetch requires its global receiver');calls++;
  if(String(url).startsWith('https://city.test/'))return Response.json({proof:'signed-test',observed_at:new Date().toISOString()});
  const body=JSON.parse(init.body);return Response.json({status:'accepted',event_id:body.event.event_id});
 };
 t.after(()=>{globalThis.fetch=originalFetch;});
 const usage=new Usage({store,url:'https://db.test',publicKey:'public',cityUrl:'https://city.test/',identityProvider:async()=>null});
 usage.schedule=()=>{};t.after(()=>usage.stop());
 const opening=await usage.openHistory();await usage.flush();
 assert.equal(calls,2);assert.equal((await store.meta(opening)).ack,true);
});
