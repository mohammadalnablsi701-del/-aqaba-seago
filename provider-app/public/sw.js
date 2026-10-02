self.addEventListener("push",event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch{payload={body:event.data?.text()||""}}
  const title=payload.title||"Aqaba SeaGo";
  const options={
    body:payload.body||"You have a new SeaGo update.",
    badge:undefined,
    tag:payload.data?.notificationId||payload.data?.screen||"seago",
    data:payload.data||{},
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
