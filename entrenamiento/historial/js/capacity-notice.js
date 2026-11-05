(() => {
 'use strict';
 const hide=()=>{const panel=document.getElementById('capacityNotice');if(panel)panel.hidden=true;};
 window.addEventListener('arbat:history-loading',hide);
 window.addEventListener('arbat:history-role',event=>{
  const panel=document.getElementById('capacityNotice');if(!panel)return;
  const signed=!!(window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.());
  panel.hidden=!(signed&&['user','coach'].includes(event.detail.role)&&event.detail.databaseNearLimit===true);
 });
 for(const event of ['buddy:auth-state-changed','buddy:user-loaded','buddy:auth-ready'])window.addEventListener(event,hide);
})();
