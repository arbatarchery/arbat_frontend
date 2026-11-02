(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatHistoryActivity=api;})(globalThis,()=>{
 'use strict';
 const competition=type=>['competition','tournament','competencia'].includes(String(type||'').toLowerCase());
 function sessionKinds(session){
  let hasCompetition=false,hasTraining=false,seen=false;
  const add=(arrows,type)=>{if(!arrows?.length)return;seen=true;if(competition(type))hasCompetition=true;else hasTraining=true;};
  for(const end of session.completed||[])add(end.arrows,end.sessionType||session.sessionType);
  add(session.current,session.sessionType);
  if(!seen)add(session.arrows,session.sessionType);
  return {hasCompetition,hasTraining};
 }
 function decorate(days,studentDays=[],includeStudentCompetition=true){
  const students=new Map(studentDays.map(day=>[day.date,day]));
  return days.map(day=>{const flags={hasCompetition:false,hasTraining:false};for(const session of day.sessions||[]){const kind=sessionKinds(session);flags.hasCompetition ||=kind.hasCompetition;flags.hasTraining ||=kind.hasTraining;}
   const student=students.get(day.date);const studentArrows=Number(student?.arrows)||0;
   const kinds=[];if(flags.hasCompetition||includeStudentCompetition&&studentArrows>0&&student.has_competition)kinds.push('competition');if(flags.hasTraining)kinds.push('training');if(studentArrows>0)kinds.push('students');
   return {...day,studentArrows,kinds,primaryKind:kinds[0]||null,secondaryKinds:kinds.slice(1)};
  });
 }
 return {competition,sessionKinds,decorate};
});
