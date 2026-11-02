import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {sessionKinds,decorate}=createRequire(import.meta.url)('../../entrenamiento/historial/js/history-activity.js');
const a={score:9,label:'9'};
test('calendar reflects per-end competition options rather than just current session settings',()=>{
 assert.deepEqual(sessionKinds({sessionType:'training',completed:[{sessionType:'competition',arrows:[a]}],current:[a]}),{hasCompetition:true,hasTraining:true});
 assert.deepEqual(sessionKinds({sessionType:'competition',completed:[{sessionType:'training',arrows:[a]}],current:[]}),{hasCompetition:false,hasTraining:true});
 assert.deepEqual(sessionKinds({sessionType:'competition',current:[],completed:[]}),{hasCompetition:false,hasTraining:false});
});
test('all three activities retain priority and independent secondary dots',()=>{
 const day={date:'2026-11-02',sessions:[{sessionType:'training',current:[a]},{sessionType:'competition',current:[a]}]};
 const [result]=decorate([day],[{date:day.date,arrows:20,has_competition:false}]);assert.equal(result.primaryKind,'competition');assert.deepEqual(result.secondaryKinds,['training','students']);assert.equal(result.studentArrows,20);
});
test('student-only activity is visible without inventing own arrows; ordinary archers get no student dots',()=>{
 const day={date:'2026-11-02',arrows:0,sessions:[]};assert.equal(decorate([day],[{date:day.date,arrows:3}])[0].primaryKind,'students');assert.equal(decorate([day])[0].primaryKind,null);
 const [competition]=decorate([day],[{date:day.date,arrows:3,has_competition:true}]);assert.equal(competition.primaryKind,'competition');assert.deepEqual(competition.secondaryKinds,['students']);
});
