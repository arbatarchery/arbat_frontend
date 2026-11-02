import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyBuddyAccessToken, BuddyIdentityError } from '../functions/_shared/buddy-identity.mjs';

const json = (value, status = 200) => Response.json(value, {status});
const valid = {ok:true, authenticated:true, user:{id:'buddy-user-1', email:'unused@example.test', role:'superadmin'}};
const token = 'test.access.token';

test('Buddy identity uses fixed HTTPS endpoint, no redirects, and only stable verified subject', async () => {
  const identity = await verifyBuddyAccessToken(token, {fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.statetty.com/api/buddy/auth/session');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    return json(valid);
  }});
  assert.deepEqual(identity, {issuer:'https://api.statetty.com', subject:'buddy-user-1'});
  assert.ok(Object.isFrozen(identity));
});

test('missing/invalid access token fails before network; refresh tokens are not requested', async () => {
  for (const invalid of [null, '', 'Bearer token', 'x\r\nInjected: value', 'x'.repeat(8193), {}]) {
    await assert.rejects(verifyBuddyAccessToken(invalid, {fetchImpl: async () => assert.fail('must not request')}), BuddyIdentityError);
  }
});

test('Buddy unauthenticated, malformed, missing stable id and upstream errors fail closed', async () => {
  for (const response of [
    json({ok:true, authenticated:false, user:null}), json({...valid, ok:false}),
    json({...valid, authenticated:'true'}), json({...valid,user:{email:'unused@example.test'}}),
    json({...valid,user:{id:' '}}), json({...valid,user:{id:7}}), json(valid,401), json(valid,500),
    new Response('<html>redirect</html>', {headers:{'content-type':'text/html'}}),
    new Response('{broken', {headers:{'content-type':'application/json'}}),
    json({...valid, padding:'x'.repeat(17000)})
  ]) await assert.rejects(verifyBuddyAccessToken(token, {fetchImpl:async()=>response}), BuddyIdentityError);
});

test('network failure, redirect rejection and timeout do not leak token or upstream error', async () => {
  for (const fetchImpl of [
    async () => {throw new Error(`upstream failed with ${token}`);},
    async (_url, {signal}) => new Promise((resolve,reject) => {
      signal.addEventListener('abort', () => reject(new Error(`timeout ${token}`)), {once:true});
    })
  ]) await assert.rejects(verifyBuddyAccessToken(token, {fetchImpl,timeoutMs:10}), e => {
    assert.ok(e instanceof BuddyIdentityError);
    assert.equal(e.message, 'Buddy session could not be verified');
    assert.ok(!e.message.includes(token));
    return true;
  });
});
