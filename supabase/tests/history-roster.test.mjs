import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {sortAthletes}=createRequire(import.meta.url)('../../entrenamiento/historial/js/history-roster.js');
const rows=[
 {name:'Zoe',last_session_at:'2026-11-05T12:00:00Z',last_session_date:'2026-11-05',day_arrows:12,day_average:9},
 {name:'Álvaro',last_session_date:'2026-11-04',day_arrows:40,day_average:7},
 {name:'Beatriz',last_session_at:'2026-11-05T14:00:00Z',last_session_date:'2026-11-05',day_arrows:6,day_average:10},
 {name:'Sin sesiones',last_session_date:null,day_arrows:0,day_average:null}
];
const names=(options)=>sortAthletes(rows,options).map(a=>a.name);
test('roster defaults to newest session and retains source order',()=>{
 assert.deepEqual(names(),['Beatriz','Zoe','Álvaro','Sin sesiones']);assert.equal(rows[0].name,'Zoe');
});
test('all roster columns support ascending and descending; missing values remain last',()=>{
 for(const [key,ascending] of [['name',['Álvaro','Beatriz','Sin sesiones','Zoe']],['date',['Álvaro','Zoe','Beatriz','Sin sesiones']],['arrows',['Beatriz','Zoe','Álvaro','Sin sesiones']],['average',['Álvaro','Zoe','Beatriz','Sin sesiones']]]){
  assert.deepEqual(names({key,direction:'asc'}),ascending);
  const descending=key==='name'?[...ascending].reverse():[...ascending.slice(0,-1)].reverse().concat('Sin sesiones');
  assert.deepEqual(names({key,direction:'desc'}),descending);
 }
});
