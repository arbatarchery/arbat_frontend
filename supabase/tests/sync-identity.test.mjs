import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {IDBFactory} from 'fake-indexeddb';import {GoTrueClient} from '@supabase/auth-js';
const require=createRequire(import.meta.url),{Store}=require('../../entrenamiento/js/sync-store.js'),{Identity}=require('../../entrenamiento/js/sync-identity.js'),{present}=require('../../entrenamiento/js/sync-ui.js');
const P='70000000-0000-4000-8000-000000000001',Q='70000000-0000-4000-8000-000000000002';
const snapshot=id=>({id,date:'2026-11-01',completed:[],current:[{label:'9',score:9,x:54,y:50}],owner:{id:'anon:device',anonymous:true}});
const setup=()=>new Store({indexedDB:new IDBFactory()});
const config={url:'https://test.supabase.co',publicKey:'sb_publishable_test',enabled:true,navigator:{}};
const jwt=id=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.dGVzdA`;

test('disabled identity does not read storage, import SDK, create users or request CAPTCHA',async()=>{
 const no=()=>assert.fail('disabled must not execute');const identity=new Identity({enabled:false,store:{readAll:no},sdkLoader:no,captchaProvider:no});assert.equal(await identity.identity(),null);
});
test('official Supabase SDK signs in with CAPTCHA and persists tokens outside legacy JSON',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('legacy'));const calls=[];
 const identity=new Identity({...config,store,sdkLoader:async()=>({GoTrueClient}),captchaProvider:async()=>'captcha-test',fetchImpl:async(url,init)=>{
  calls.push(url);assert.ok(url.endsWith('/auth/v1/signup'));assert.equal(JSON.parse(init.body).gotrue_meta_security.captcha_token,'captcha-test');
  return Response.json({access_token:jwt(P),refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:{id:P,is_anonymous:true}});
 }});t.after(()=>identity.stop());
 const result=await identity.identity();assert.equal(result.principalId,P);assert.equal(result.accountKey,null);assert.equal(calls.length,1);
 const again=await identity.identity();assert.equal(again.principalId,P);assert.equal(calls.length,1);
 assert.deepEqual((await store.readAll('sessions'))[0].snapshot,snapshot('legacy'));
 assert.ok(JSON.stringify(await store.readAll('meta')).includes('test-refresh'));
 assert.ok(!JSON.stringify(await store.status()).includes('test-refresh'));
});
test('missing CAPTCHA never calls anonymous signup',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('legacy'));
 const client={getSession:async()=>({data:{session:null}}),signInAnonymously:()=>assert.fail('no signup')};
 const identity=new Identity({...config,store,sdkLoader:async()=>({GoTrueClient:class{constructor(){return client;}}})});
 await assert.rejects(identity.identity(),e=>e.code==='captcha_required');
});
test('login adopts guest credentials, logout makes another guest and previous account credentials survive',async t=>{
 const store=setup();t.after(()=>store.close());const record=await store.capture(snapshot('first'));let buddy={accountKey:null,buddyToken:null},created=0;const sessions=new Map();
 class Client{constructor(opts){this.key=opts.storageKey;}async getSession(){return {data:{session:sessions.get(this.key)}};}async signInAnonymously(){const s={user:{id:++created===1?P:Q},access_token:'test-access'};sessions.set(this.key,s);return {data:{session:s}};}}
 const identity=new Identity({...config,store,getBuddy:()=>buddy,sdkLoader:async()=>({GoTrueClient:Client}),captchaProvider:async()=>'captcha'});
 assert.equal((await identity.identity()).principalId,P);await store.prepare(record.key,{principalId:P,accountKey:null});
 buddy={accountKey:'buddy-A',buddyToken:'buddy-access'};assert.equal((await identity.identity()).principalId,P);
 await store.prepare(record.key,{principalId:P,accountKey:'buddy-A'});
 buddy={accountKey:null,buddyToken:null};await store.capture(snapshot('second'));assert.equal((await identity.identity()).principalId,Q);
 buddy={accountKey:'buddy-A',buddyToken:'buddy-access'};assert.equal((await identity.identity()).principalId,P);assert.equal(created,2);
});
test('lost credential of an existing principal is not silently replaced with a new anonymous user',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('first'));
 const key=`auth-registry:${config.url}`;await store.meta(key,{guest:'bucket',buckets:[{key:'bucket',principalId:P,accountKey:null}]});
 const identity=new Identity({...config,store,sdkLoader:async()=>({GoTrueClient:class{async getSession(){return {data:{session:null}};}signInAnonymously(){assert.fail('must not replace principal');}}})});
 await assert.rejects(identity.identity(),e=>e.code==='auth_recovery_required');
});
test('changing Buddy identity during credential retrieval prevents returning a session',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('first'));let buddy={accountKey:'A',buddyToken:'token-A'};
 const identity=new Identity({...config,store,getBuddy:()=>buddy,sdkLoader:()=>assert.fail('Buddy must not load anonymous SDK'),fetchImpl:async()=>{buddy={accountKey:'B',buddyToken:'token-B'};return Response.json({status:'accepted',principal_id:P,subject:'A'});}});
 await assert.rejects(identity.identity(),e=>e.code==='auth_changed');
});
test('bar never shows green from queue emptiness alone; all five states are distinct',()=>{
 assert.equal(present({state:'synced',pending:0,localSaved:true}).color,'gray');
 assert.equal(present({state:'synced',pending:0,localSaved:true,lastConfirmedAt:1}).color,'green');
 assert.equal(present({state:'synced',pending:1,localSaved:true,lastConfirmedAt:1}).color,'yellow');
 assert.equal(present({state:'disabled',pending:4,localSaved:true}).color,'gray');
 assert.equal(present({state:'syncing',pending:4,localSaved:true}).color,'blue');
 assert.equal(present({state:'disabled',localSaved:false}).color,'red');
 assert.equal(present({state:'offline',pending:4,localSaved:true}).color,'yellow');
});

test('official SDK refreshes an expired session without creating another anonymous user',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('first'));let signups=0,refreshes=0;
 const identity=new Identity({...config,store,sdkLoader:async()=>({GoTrueClient}),captchaProvider:async()=>'captcha',fetchImpl:async(url,init)=>{
  if(url.endsWith('/signup'))signups++;else{assert.ok(url.includes('/token?grant_type=refresh_token'));assert.equal(JSON.parse(init.body).refresh_token,'refresh-1');refreshes++;}
  return Response.json({access_token:jwt(P),refresh_token:refreshes?'refresh-2':'refresh-1',expires_in:3600,token_type:'bearer',user:{id:P,is_anonymous:true}});
 }});t.after(()=>identity.stop());await identity.identity();
 const credential=(await store.readAll('meta')).find(r=>r.key.startsWith('auth-credential:')&&String(r.value).includes('refresh-1'));
 const saved=JSON.parse(credential.value);saved.expires_at=Math.floor(Date.now()/1000)-10;await store.meta(credential.key,JSON.stringify(saved));
 assert.equal((await identity.identity()).principalId,P);assert.equal(signups,1);assert.equal(refreshes,1);
 assert.ok(JSON.stringify(await store.readAll('meta')).includes('refresh-2'));
});

test('verified Buddy bootstraps without CAPTCHA or Supabase signup and reuses its principal',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('first'));let requests=0;
 const options={...config,store,getBuddy:()=>({accountKey:'buddy-A',buddyToken:'buddy-token'}),sdkLoader:()=>assert.fail('no anonymous SDK'),captchaProvider:()=>assert.fail('no CAPTCHA'),fetchImpl:async(url,init)=>{
  requests++;assert.ok(url.endsWith('/functions/v1/training-sync'));assert.equal(init.headers.Authorization,`Bearer ${config.publicKey}`);assert.equal(init.headers['x-buddy-access-token'],'buddy-token');assert.equal(JSON.parse(init.body).action,'buddy.session');return Response.json({status:'accepted',principal_id:P,subject:'buddy-A'});
 }};
 const identity=new Identity(options);const first=await identity.identity();assert.equal(first.principalId,P);assert.equal(first.buddyVerified,true);assert.equal(first.supabaseToken,undefined);
 assert.equal((await identity.identity()).principalId,P);assert.equal((await new Identity(options).identity()).principalId,P);assert.equal(requests,1);
});
test('rejected Buddy bootstrap cannot fall back to anonymous CAPTCHA',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('first'));
 const identity=new Identity({...config,store,getBuddy:()=>({accountKey:'A',buddyToken:'invalid'}),captchaProvider:()=>assert.fail('no CAPTCHA fallback'),sdkLoader:()=>assert.fail('no SDK fallback'),fetchImpl:async()=>Response.json({error:'buddy_session_unverified'},{status:401})});
 await assert.rejects(identity.identity(),e=>e.code==='buddy_auth_required');
});

test('Supabase rejection of a completed CAPTCHA surfaces its cause without exposing server response details',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('first'));
 const identity=new Identity({...config,store,captchaProvider:async()=>'fake-completed-token',sdkLoader:async()=>({GoTrueClient:class{async getSession(){return {data:{session:null}};}async signInAnonymously(){return {error:{code:'captcha_failed',message:'private server detail'}};}}})});
 await assert.rejects(identity.identity(),e=>e.code==='captcha_rejected'&&!e.message.includes('private server detail'));
 assert.equal((await store.readAll('sessions'))[0].principalId,null);
});

test('initial history establishes Buddy identity after a concurrent empty sync check',async t=>{
 const store=setup();t.after(()=>store.close());let bridgeCalls=0;
 const identity=new Identity({...config,store,getBuddy:()=>({accountKey:'buddy-A',buddyToken:'buddy-token'}),sdkLoader:()=>assert.fail('no anonymous identity'),captchaProvider:()=>assert.fail('no CAPTCHA'),fetchImpl:async()=>{bridgeCalls++;return Response.json({status:'accepted',principal_id:P,subject:'buddy-A'});}});
 const background=identity.identity();const history=identity.identity({forHistory:true});
 assert.equal(await background,null);assert.equal((await history).principalId,P);assert.equal(bridgeCalls,1);
});
test('a concurrent history request without an account terminates without creating credentials',async t=>{
 const store=setup();t.after(()=>store.close());const no=()=>assert.fail('no credentials for an empty signed-out device');
 const identity=new Identity({...config,store,sdkLoader:no,captchaProvider:no,fetchImpl:no});
 assert.deepEqual(await Promise.all([identity.identity(),identity.identity({forHistory:true})]),[null,null]);
});
