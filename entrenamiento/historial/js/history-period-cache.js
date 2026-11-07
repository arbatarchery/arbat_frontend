(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatHistoryPeriodCache=api;})(globalThis,()=>{
 'use strict';
 class PeriodCache{
  open(key,options){if(this.entry?.key===key)return this.entry;this.clear();return this.entry=new Entry(key,options);}
  clear(){this.entry?.stop();this.entry=null;}
 }
 class Entry{
  constructor(key,{account,selected,loadSelected,loadContext,loadRoster,loadAll,partition}){
   Object.assign(this,{key,account,loadSelected,loadAll,partition});this.controller=new AbortController();this.signal=this.controller.signal;this.values=new Map();this.tasks=new Map();this.allPromise=null;this.allData=null;this.prefetchState='waiting';
   this.context=Promise.resolve().then(()=>loadContext(this.signal)).then(value=>{this.active();return this.contextValue=value;});
   this.context.catch(()=>{});
   this.priority=selected.allAthletes?this.allNow():this.one(selected);
   this.priority.catch(()=>{});
   // The roster and full-period transfer do not compete with the priority user's details.
   this.metadata=Promise.all([this.context,this.priority.catch(()=>null)]).then(async([context])=>{this.active();const overview=context.can_coach?await loadRoster(this.signal):null;this.active();return this.metadataValue={context,overview};});
   this.metadata.catch(()=>{});
  }
  active(){this.signal.throwIfAborted();}
  one(user){
   this.active();if(this.values.has(user.id))return Promise.resolve(this.values.get(user.id));if(this.tasks.has(user.id))return this.tasks.get(user.id);
   const task=Promise.resolve().then(()=>this.loadSelected(user,this.signal)).then(value=>{this.active();this.values.set(user.id,value);return value;});this.tasks.set(user.id,task);task.catch(()=>{});return task;
  }
  allNow(){
   this.active();if(this.allPromise)return this.allPromise;
   this.prefetchState='loading';
   this.allPromise=Promise.all([this.context,(this.priority||Promise.resolve()).catch(()=>null)]).then(async ([context])=>{this.active();if(!context.can_coach)throw Object.assign(new Error('auth_required'),{code:'auth_required'});const data=await this.loadAll(this.signal);this.active();this.allData=data;this.prefetchState='ready';return data;}).catch(error=>{this.prefetchState='failed';throw error;});
   this.allPromise.catch(()=>{});return this.allPromise;
  }
  async preload(){await this.priority.catch(()=>null);const meta=await this.metadata;this.active();if(!meta.context.can_coach)return;return this.allNow();}
  async get(user){
   this.active();if(user.allAthletes)return this.allNow();if(this.values.has(user.id))return this.values.get(user.id);if(this.tasks.has(user.id))return this.tasks.get(user.id);
   const meta=await this.metadata;this.active();
   if(!meta.context.can_coach){if(user.id!==this.account)throw Object.assign(new Error('auth_required'),{code:'auth_required'});return this.one(user);}
   if(user.id!==this.account&&!meta.overview?.athletes.some(a=>a.subject===user.id))throw Object.assign(new Error('auth_required'),{code:'auth_required'});
   const all=await this.allNow();this.active();const data=this.partition(user,all,meta);this.values.set(user.id,data);return data;
  }
  stop(){this.controller.abort();this.values.clear();this.tasks.clear();this.allData=null;this.contextValue=null;this.metadataValue=null;}
 }
 return {PeriodCache};
});
