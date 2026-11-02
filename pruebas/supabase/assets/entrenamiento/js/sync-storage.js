(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.ArbatSyncStorage=api;const prefix=root.ArbatTrainingSyncConfig?.storagePrefix;root.ArbatTrainingStorage=api.namespaced(api.access(root),prefix||'');}})(globalThis,()=>{
 'use strict';
 function access(root){try{return root.localStorage;}catch(error){return {get length(){throw error;},getItem(){throw error;},setItem(){throw error;},key(){throw error;},removeItem(){throw error;}};}}
 function namespaced(storage,prefix){
  if(!prefix)return storage;
  if(typeof prefix!=='string'||prefix.length>128)throw new Error('invalid_storage_prefix');
  const keys=()=>{const result=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(typeof key==='string'&&key.startsWith(prefix))result.push(key.slice(prefix.length));}return result;};
  return {get length(){return keys().length;},key:index=>keys()[index]??null,
   getItem:key=>storage.getItem(prefix+String(key)),setItem:(key,value)=>storage.setItem(prefix+String(key),String(value)),
   removeItem:key=>storage.removeItem(prefix+String(key)),clear:()=>{for(const key of keys())storage.removeItem(prefix+key);}};
 }
 return {namespaced,access};
});
