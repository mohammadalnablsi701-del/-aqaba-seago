import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativePushFeatureEnabled, resolvePushChannel } from "../src/nativePushConfig.js";
import { disableNativePush } from "../src/nativePush.js";
import { expireAuthenticatedSession, reconcileAuthPush } from "../src/api.js";
import { revokeCurrentNotificationCredentials } from "../src/notificationCredentialLifecycle.js";
import {
  decodeFirebaseAndroidConfig,
  ensureGoogleServicesGradle,
  validateFirebaseAndroidConfig
} from "./prepare-android-fcm.mjs";

const valid={
  project_info:{project_id:"aqaba-seago-7c92"},
  client:[{client_info:{android_client_info:{package_name:"com.aqabaseago.app"}}}]
};

assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"false"}),false);
assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"true"}),true);
assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"android"}),"native-android");
assert.equal(resolvePushChannel({enabled:false,isNative:true,platform:"android"}),"native-disabled");
assert.equal(resolvePushChannel({enabled:true,isNative:false,platform:"web"}),"web");
assert.deepEqual(validateFirebaseAndroidConfig(valid),{projectId:"aqaba-seago-7c92",packageName:"com.aqabaseago.app"});
assert.throws(()=>validateFirebaseAndroidConfig({...valid,project_info:{project_id:"wrong-project"}}),/project_id mismatch/);
assert.throws(()=>validateFirebaseAndroidConfig({project_info:valid.project_info,client:[{client_info:{android_client_info:{package_name:"wrong.package"}}}]}),/package_name mismatch/);
assert.throws(()=>decodeFirebaseAndroidConfig("",{required:true}),/required/);
const encoded=Buffer.from(JSON.stringify(valid)).toString("base64");
assert.equal(decodeFirebaseAndroidConfig(encoded,{required:true}).project_info.project_id,"aqaba-seago-7c92");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"seago-fcm-"));
try{
  fs.mkdirSync(path.join(tmp,"app"),{recursive:true});
  fs.writeFileSync(path.join(tmp,"build.gradle"),"buildscript {\n    dependencies {\n        classpath 'com.android.tools.build:gradle:8.13.0'\n    }\n}\n");
  fs.writeFileSync(path.join(tmp,"app","build.gradle"),"android { }\n");
  ensureGoogleServicesGradle(tmp);
  assert.match(fs.readFileSync(path.join(tmp,"build.gradle"),"utf8"),/com\.google\.gms:google-services:4\.4\.4/);
  assert.match(fs.readFileSync(path.join(tmp,"app","build.gradle"),"utf8"),/apply plugin: 'com\.google\.gms\.google-services'/);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

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
    serverUnsubscribe:serverUnsubscribe||async()=>{},
    pushNotifications:{unregister:unregister||async()=>{}},
    logger:logger||{warn(){}}
  };
}

// 1. Explicit logout: successful backend revoke must still locally unregister Android FCM.
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

// 2. Explicit logout: backend revoke failure must not prevent local FCM invalidation.
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

// 3. Session expiry: no authenticated revoke is required; local unregister and metadata clearing are deterministic.
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

// 4. Account switch A -> B: old A binding is revoked/unregistered before B is returned to the caller.
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

// A switch cannot silently continue when neither server revoke nor local invalidation succeeded.
seedNativeState();
await assert.rejects(
  reconcileAuthPush({token:"auth-B"},{
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
    nativeCleanup:async()=>({serverRevoked:false,localUnregistered:false,native:true})
  }),
  /Native notification credential cleanup failed/
);

// 5. Repeated cleanup is idempotent: no crash and no stale registration metadata.
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

// 6. unregister failure is reported safely, metadata is still cleared, and raw token/provider text is never logged.
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

console.log("native push config and lifecycle tests passed");
