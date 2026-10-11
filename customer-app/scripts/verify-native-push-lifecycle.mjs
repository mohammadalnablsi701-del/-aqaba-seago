import assert from "node:assert/strict";
import { disableNativePush } from "../src/nativePush.js";
import { expireAuthenticatedSession, reconcileAuthPush } from "../src/api.js";
import { revokeCurrentNotificationCredentials } from "../src/notificationCredentialLifecycle.js";

const INSTALLATION_KEY="seago_native_installation_id";
const REGISTERED_KEY="seago_native_push_registered";
const AUTH_KEY="seago_auth";
const INSTALLATION="installation_native_A_123456";

class MemoryStorage{
  constructor(){this.values=new Map();}
  getItem(key){return this.values.has(key)?this.values.get(key):null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
  clear(){this.values.clear();}
}

globalThis.localStorage=new MemoryStorage();
const sessionEvents=[];
globalThis.window={dispatchEvent:event=>{sessionEvents.push(event.type);return true;}};
if(typeof globalThis.CustomEvent==="undefined")globalThis.CustomEvent=class CustomEvent{constructor(type){this.type=type;}};

function seedNativeState({authToken="auth-A"}={}){
  localStorage.clear();
  localStorage.setItem(INSTALLATION_KEY,INSTALLATION);
  localStorage.setItem(REGISTERED_KEY,"1");
  if(authToken)localStorage.setItem(AUTH_KEY,JSON.stringify({token:authToken,user:{id:"A"}}));
  sessionEvents.length=0;
}

function nativeCleanupOptions({serverUnsubscribe,unregister,logger}={}){
  return {
    native:true,
    android:true,
    serverUnsubscribe:serverUnsubscribe||(async()=>{}),
    pushNotifications:{unregister:unregister||(async()=>{})},
    logger:logger||{warn(){}}
  };
}

seedNativeState();
{
  const order=[];
  const settled=await revokeCurrentNotificationCredentials("auth-A",{
    androidNative:true,
    disableNotifications:token=>disableNativePush(token,nativeCleanupOptions({
      serverUnsubscribe:async(id,auth)=>{assert.equal(id,INSTALLATION);assert.equal(auth,"auth-A");order.push("server");},
      unregister:async()=>{order.push("unregister");}
    }))
  });
  assert.equal(settled[0].status,"fulfilled");
  assert.equal(settled[0].value.serverRevoked,true);
  assert.equal(settled[0].value.localUnregistered,true);
  assert.deepEqual(order,["server","unregister"]);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
}

seedNativeState();
{
  let unregisterCalls=0;
  const settled=await revokeCurrentNotificationCredentials("auth-A",{
    androidNative:true,
    disableNotifications:token=>disableNativePush(token,nativeCleanupOptions({
      serverUnsubscribe:async()=>{throw new Error("backend unavailable");},
      unregister:async()=>{unregisterCalls++;}
    }))
  });
  assert.equal(settled[0].status,"fulfilled");
  assert.equal(settled[0].value.serverRevoked,false);
  assert.equal(settled[0].value.localUnregistered,true);
  assert.equal(unregisterCalls,1);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
}

seedNativeState();
{
  let cleanupToken="not-called";
  let unregisterCalls=0;
  const result=await expireAuthenticatedSession({
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
    nativeCleanup:token=>{
      cleanupToken=token;
      return disableNativePush(token,nativeCleanupOptions({unregister:async()=>{unregisterCalls++;}}));
    },
    logger:{warn(){}}
  });
  assert.equal(cleanupToken,"");
  assert.equal(result.cleaned,true);
  assert.equal(result.localUnregistered,true);
  assert.equal(unregisterCalls,1);
  assert.equal(localStorage.getItem(AUTH_KEY),null);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.deepEqual(sessionEvents,["seago:session-expired"]);
}

seedNativeState();
{
  const order=[];
  const result=await reconcileAuthPush({token:"auth-B",user:{id:"B"}},{
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
    nativeCleanup:token=>disableNativePush(token,nativeCleanupOptions({
      serverUnsubscribe:async(id,auth)=>{assert.equal(id,INSTALLATION);assert.equal(auth,"auth-A");order.push("revoke-A");},
      unregister:async()=>{order.push("unregister-A");}
    }))
  });
  assert.equal(result.token,"auth-B");
  assert.deepEqual(order,["revoke-A","unregister-A"]);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.equal(JSON.parse(localStorage.getItem(AUTH_KEY)).token,"auth-A");
}

seedNativeState();
await assert.rejects(
  reconcileAuthPush({token:"auth-B"},{
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
    nativeCleanup:async()=>({serverRevoked:false,localUnregistered:false,native:true})
  }),
  /Native notification credential cleanup failed/
);

seedNativeState();
{
  let serverCalls=0;
  let unregisterCalls=0;
  const options=nativeCleanupOptions({
    serverUnsubscribe:async()=>{serverCalls++;},
    unregister:async()=>{unregisterCalls++;}
  });
  const first=await disableNativePush("auth-A",options);
  const second=await disableNativePush("auth-A",options);
  assert.equal(first.localUnregistered,true);
  assert.equal(second.localUnregistered,true);
  assert.equal(serverCalls,1);
  assert.equal(unregisterCalls,2);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
}

seedNativeState();
{
  const rawToken="raw-fcm-token-that-must-never-appear-in-logs";
  const logs=[];
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{throw new Error(`backend echoed ${rawToken}`);},
    unregister:async()=>{throw new Error(`provider echoed ${rawToken}`);},
    logger:{warn:value=>logs.push(String(value))}
  }));
  assert.equal(result.serverRevoked,false);
  assert.equal(result.localUnregistered,false);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.equal(JSON.stringify(logs).includes(rawToken),false);
  assert.deepEqual(logs,["Native push local unregister failed"]);
}

console.log("native push lifecycle behavioral tests passed");
