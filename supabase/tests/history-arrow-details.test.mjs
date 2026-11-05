import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {clockLabel}=createRequire(import.meta.url)('../../entrenamiento/historial/js/history-arrow-details.js');
test('clock direction uses target centre and rounds to whole hours',()=>{
 for(const [x,y,hour] of [[50,20,12],[80,50,3],[50,80,6],[20,50,9],[65,24,1],[35,24,11]])assert.equal(clockLabel({score:8,x,y}),`8 a las ${hour}`);
 assert.equal(clockLabel({label:'X',score:10,x:50,y:50}),'X · centro');
 for(const x of [null,undefined,'',NaN,Infinity])assert.equal(clockLabel({score:8,x,y:20}),'8 · sin dirección');
 assert.equal(clockLabel({score:8,x:'80',y:'50'}),'8 a las 3');
});
