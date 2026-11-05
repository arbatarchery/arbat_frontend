(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatHistoryArrowDetails=api;})(globalThis,()=>{
 'use strict';
 const coordinate=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v));
 function clockLabel(arrow){
  const score=String(arrow.label??arrow.score??'—');
  if(!coordinate(arrow.x)||!coordinate(arrow.y))return `${score} · sin dirección`;
  const dx=Number(arrow.x)-50,dy=Number(arrow.y)-50;
  if(Math.hypot(dx,dy)<1e-8)return `${score} · centro`;
  const angle=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
  const hour=Math.round(angle/30)%12||12;
  return `${score} a las ${hour}`;
 }
 return {clockLabel};
});
