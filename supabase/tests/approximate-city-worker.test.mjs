import {test} from 'node:test';import assert from 'node:assert/strict';import worker from '../setup/approximate-city-worker.mjs';
function request({cf,origin='https://arbatarchery.com',method='GET',path='/'}={}){
 const req=new Request('https://arbat-city.example.workers.dev'+path,{method,headers:{...(origin===null?{}:{Origin:origin}),'CF-Connecting-IP':'203.0.113.10','CF-IPCity':'Fake client city',Authorization:'Bearer do-not-return'}});
 if(cf)Object.defineProperty(req,'cf',{value:cf});return req;
}
test('city uses only Cloudflare request metadata, never geographic headers or query parameters',async()=>{
 const response=await worker.fetch(request({cf:{city:'La Paz',region:'La Paz Department',country:'BO',latitude:'-16.5',longitude:'-68.15'},path:'/?ip=198.51.100.1&city=Invented'}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{schema_version:1,available:true,source:'cloudflare-ip',approximate:true,city:'La Paz',region:'La Paz Department',country:'BO'});
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://arbatarchery.com');assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('missing city stays unavailable and is not replaced with a guessed location',async()=>{
 const response=await worker.fetch(request());assert.deepEqual(await response.json(),{schema_version:1,available:false,source:'cloudflare-ip',approximate:true,city:null,region:null,country:null});
});
test('response excludes IP addresses, coordinates, credentials and unknown platform metadata',async()=>{
 const response=await worker.fetch(request({cf:{city:'Cochabamba',region:'Cochabamba',country:'BO',latitude:-17.39,longitude:-66.15,ip:'198.51.100.3',private:'private-platform-field'}}));
 const body=await response.text();for(const forbidden of ['latitude','longitude','198.51.100','203.0.113','private-platform-field','do-not-return'])assert.ok(!body.includes(forbidden));
 assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
});
test('foreign origins and unsupported methods cannot read location through this CORS endpoint',async()=>{
 assert.equal((await worker.fetch(request({origin:'https://unrelated.example'}))).status,403);
 assert.equal((await worker.fetch(request({method:'POST'}))).status,405);assert.equal((await worker.fetch(request({path:'/another-person'}))).status,404);
});
test('public URL can be tested directly and supports localhost without secret keys',async()=>{
 assert.equal((await worker.fetch(request({origin:null,cf:{city:'Santa Cruz',country:'BO'}}))).status,200);
 assert.equal((await worker.fetch(request({origin:'http://localhost:8000',method:'OPTIONS'}))).status,204);
});
test('labels are bounded and country is normalized without inventing values',async()=>{
 const data=await(await worker.fetch(request({cf:{city:'  '+ 'x'.repeat(500)+'  ',region:'  ',country:'XX'}}))).json();assert.equal(data.city.length,120);assert.equal(data.region,null);assert.equal(data.country,null);
});
