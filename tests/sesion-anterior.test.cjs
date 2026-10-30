const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('entrenamiento/js/entrenamiento.js','utf8');
const helpers=script.slice(script.indexOf('  function constellationArrows('),script.indexOf('  function drawConstellation('));
function setup({history=[],state={},memory,corrupt=false,owner={id:'user:1',anonymous:false}}={}){
 const current={id:'now',completed:[],current:[],arrowsPerEnd:6,...state};
 const context={state:current,window:{arbatLastCompletedSession:memory},historyStorageKey:'history',ownerSnapshot:()=>owner,localStorage:{getItem:()=>corrupt?'invalid':JSON.stringify(history)}};
 vm.createContext(context);vm.runInContext(helpers,context);return context;
}
const previous={id:'before',owner:{id:'user:1'},date:'2026-10-29',endedAt:'2026-10-29T15:00:00Z',arrowsPerEnd:3,completed:[{arrows:[{x:60,y:40,score:7,label:'7'}],shootingDistance:'18',targetSize:'40'}],current:[]};
test('previous session available with empty current and partial first end; data unchanged',()=>{
 for(const current of [[],[{score:10}]]){
 const a=setup({history:[previous],state:{current}}),before=JSON.stringify(a.state);
 assert.equal(a.previousConstellationSession().id,'before');
 assert.equal(a.constellationArrows(a.previousConstellationSession()).length,1);
 assert.equal(a.constellationMeasurement('targetSize',a.previousConstellationSession()),'40');
 assert.equal(JSON.stringify(a.state),before);
 }
});
test('hidden after a completed end or a full pending first end',()=>{
 for(const state of [{completed:[{arrows:[{score:10}]}]},{current:Array(6).fill({score:10})}]){
 assert.equal(setup({history:[previous],state}).previousConstellationSession(),null);
 }
});
test('no history, malformed storage, empty sessions and current id produce no previous session',()=>{
 for(const args of [{},{corrupt:true},{history:[{...previous,completed:[]}]},{history:[{...previous,id:'now'}]}])assert.equal(setup(args).previousConstellationSession(),null);
});
test('select most recent same owner, excluding another athlete',()=>{
 const a=setup({history:[previous,{...previous,id:'latest',endedAt:'2026-10-30T10:00:00Z'},{...previous,id:'other',owner:{id:'user:2'},endedAt:'2026-10-30T12:00:00Z'}]});
 assert.equal(a.previousConstellationSession().id,'latest');
});
test('legacy ownerless sessions are available only to anonymous device user',()=>{
 const legacy={...previous,owner:undefined};
 assert.equal(setup({history:[legacy]}).previousConstellationSession(),null);
 assert.equal(setup({history:[legacy],owner:{id:'anon:device',anonymous:true}}).previousConstellationSession().id,'before');
});
test('storage failure still permits last completed in-memory session',()=>{
 assert.equal(setup({corrupt:true,memory:previous}).previousConstellationSession().id,'before');
});

test('previous-session click exports its own metadata and download date without altering current data',()=>{
 const a=setup({history:[previous]}),elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return elements.get(id);};
 let exported,download;
 Object.assign(a,{$:element,URL:{createObjectURL:()=> 'blob:previous',revokeObjectURL(){}},document:{createElement:()=>download={click(){},remove(){}},body:{append(){}}}});
 a.window.ArbatConstellation={createCanvas:args=>{exported=args;return {toBlob:callback=>callback({})};}};
 vm.runInContext(script.slice(script.indexOf('  const constellationOverlay='),script.indexOf('  function render(){')),a);
 const before=JSON.stringify(a.state);
 element('previousConstellationBtn').handlers.click();
 assert.equal(exported.date,previous.date);assert.equal(exported.arrowsPerEnd,3);assert.equal(exported.rounds,1);
 assert.equal(exported.shootingDistance,'18');assert.equal(exported.targetSize,'40');
 assert.equal(element('constellationOverlay').hidden,false);
 element('constellationDownload').handlers.click();
 assert.equal(download.download,'arbat-constelacion-2026-10-29.png');
 assert.equal(JSON.stringify(a.state),before);
});
