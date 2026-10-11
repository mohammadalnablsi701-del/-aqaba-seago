const SAFE_SCREENS=new Set(["notifications","tickets"]);
const SAFE_ID=/^[A-Za-z0-9_-]{1,80}$/;

function safeText(value,fallback,max){
  return typeof value==="string"&&value.trim()?value.trim().slice(0,max):fallback;
}
function safeData(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const data={};
  if(SAFE_SCREENS.has(value.screen))data.screen=value.screen;
  const notificationId=String(value.notificationId||"");
  if(SAFE_ID.test(notificationId))data.notificationId=notificationId;
  return data;
}

self.addEventListener("push",event=>{
  let payload={};
  try{
    const parsed=event.data?event.data.json():{};
    if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))payload=parsed;
  }catch{payload={};}
  const data=safeData(payload.data);
  const title=safeText(payload.title,"Aqaba SeaGo",80);
  const options={
    body:safeText(payload.body,"You have a new SeaGo update.",180),
    icon:"./apple-touch-icon-v4.png",
    badge:undefined,
    tag:data.notificationId||data.screen||"seago",
    data,
    renotify:true
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL("./?open=notifications",self.registration.scope).href;
  event.waitUntil((async()=>{
    const wins=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const w of wins){if("focus"in w){await w.focus();if("navigate"in w)await w.navigate(target);return;}}
    if(clients.openWindow)return clients.openWindow(target);
  })());
});
