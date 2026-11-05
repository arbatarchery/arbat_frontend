(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatHistoryRoster=api;})(globalThis,()=>{
 'use strict';
 function sortAthletes(athletes,{key='date',direction='desc'}={}){
  const value=a=>key==='name'?String(a.name||''):key==='date'?(a.last_session_at||a.last_session_date?Date.parse(a.last_session_at||a.last_session_date+'T00:00:00-04:00'):null):key==='arrows'?(a.last_session_date?a.day_arrows:null):a.day_average;
  return [...athletes].sort((a,b)=>{
   const av=value(a),bv=value(b),missing=v=>v==null||typeof v==='number'&&!Number.isFinite(v);
   if(missing(av)!==missing(bv))return missing(av)?1:-1;
   const result=missing(av)?0:key==='name'?av.localeCompare(bv,'es',{sensitivity:'base',numeric:true}):Number(av)-Number(bv);
   return result?(direction==='asc'?result:-result):String(a.name||'').localeCompare(String(b.name||''),'es',{sensitivity:'base'});
  });
 }
 return {sortAthletes};
});
