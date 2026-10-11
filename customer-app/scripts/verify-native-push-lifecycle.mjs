import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Capacitor } from "@capacitor/core";
import { disableNativePush, enableNativePush, nativePushCleanupState } from "../src/nativePush.js";
import { expireAuthenticatedSession, reconcileAuthPush } from "../src/api.js";
import { revokeCurrentNotificationCredentials } from "../src/notificationCredentialLifecycle.js";

const INSTALLATION_KEY="seago_native_installation_id";
const REGISTERED_KEY="seago_native_push_registered";
const OWNER_KEY="seago_native_push_owner_id";
const CLEANUP_PENDING_KEY="seago_native_push_cleanup_pending";
const AUTH_KEY="seago_auth";
const INSTALLATION="installation_native_A_123456";
const INSTALLATION_B="installation_native_B_654321";

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

function deferred(){
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}

function seedAuth(owner="A",token=`auth-${owner}`){
  localStorage.setItem(AUTH_KEY,JSON.stringify({token,user:{id:owner}}));
}

function seedNativeState({authToken="auth-A",ownerId="A",registered=true}={}){
  localStorage.clear();
  localStorage.setItem(INSTALLATION_KEY,INSTALLATION);
  if(registered)localStorage.setItem(REGISTERED_KEY,"1");
  if(ownerId)localStorage.setItem(OWNER_KEY,ownerId);
  if(authToken)localStorage.setItem(AUTH_KEY,JSON.stringify({token:authToken,user:{id:ownerId||"A"}}));
  sessionEvents.length=0;
}

function pendingState(){
  const raw=localStorage.getItem(CLEANUP_PENDING_KEY);
  return raw?JSON.parse(raw):null;
}

function nativeCleanupOptions({serverUnsubscribe,unregister,logger,ownerId="A"}={}){
  return {
    native:true,
    android:true,
    ownerId,
    serverUnsubscribe:serverUnsubscribe||(async()=>{}),
    pushNotifications:{unregister:unregister||(async()=>{})},
    logger:logger||{warn(){}}
  };
}

// Existing logout path still revokes server first, then local registration.
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
  assert.equal(settled[0].value.cleanupComplete,true);
  assert.deepEqual(order,["server","unregister"]);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
}

// P1-A: subscribe is in flight, logout cleanup finishes first, then old subscribe completes.
localStorage.clear();
seedAuth("A","auth-A");
{
  const subscribeStarted=deferred();
  const releaseSubscribe=deferred();
  const cleanupServerPass=deferred();
  const compensated=deferred();
  const bindings=new Map();
  const unsubscribeCalls=[];
  const listeners=new Map();
  const fakePush={
    checkPermissions:async()=>({receive:"granted"}),
    requestPermissions:async()=>({receive:"granted"}),
    addListener:async(name,callback)=>{
      listeners.set(name,callback);
      return {remove:async()=>{listeners.delete(name);}};
    },
    register:async()=>{},
    unregister:async()=>{}
  };
  const serverSubscribe=async({installationId},auth)=>{
    assert.equal(auth,"auth-A");
    subscribeStarted.resolve(installationId);
    await releaseSubscribe.promise;
    bindings.set(installationId,"A");
  };
  const serverUnsubscribe=async(id,auth)=>{
    unsubscribeCalls.push({id,auth});
    bindings.delete(id);
    if(unsubscribeCalls.length===1)cleanupServerPass.resolve();
    if(unsubscribeCalls.length===2)compensated.resolve();
  };

  await enableNativePush("auth-A",{
    enabled:true,pushNotifications:fakePush,serverSubscribe,serverUnsubscribe,platform:"android",ownerId:"A",logger:{warn(){}}
  });
  const registrationHandler=listeners.get("registration");
  assert.equal(typeof registrationHandler,"function");
  registrationHandler({value:"raw-fcm-token-for-race-test-1234567890"});
  const oldInstallation=await subscribeStarted.promise;

  const cleanupPromise=disableNativePush("auth-A",nativeCleanupOptions({serverUnsubscribe,unregister:async()=>{}}));
  await cleanupServerPass.promise;
  assert.equal(bindings.has(oldInstallation),false);
  assert.equal(nativePushCleanupState().cleanupPending,true);

  // The old subscribe now finishes after the first unsubscribe. Cleanup stays pending
  // until the stale callback performs its compensating revoke.
  releaseSubscribe.resolve();
  await compensated.promise;
  const cleanup=await cleanupPromise;
  assert.equal(cleanup.cleanupComplete,true);
  assert.equal(bindings.has(oldInstallation),false);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);

  // A later B lifecycle starts only after A's in-flight registration is settled.
  localStorage.setItem(INSTALLATION_KEY,INSTALLATION_B);
  localStorage.setItem(REGISTERED_KEY,"1");
  localStorage.setItem(OWNER_KEY,"B");
  bindings.set(INSTALLATION_B,"B");
  await Promise.resolve();

  assert.equal(bindings.get(INSTALLATION_B),"B");
  assert.deepEqual(unsubscribeCalls,[
    {id:oldInstallation,auth:"auth-A"},
    {id:oldInstallation,auth:"auth-A"}
  ]);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),INSTALLATION_B);
  assert.equal(localStorage.getItem(OWNER_KEY),"B");
  assert.equal(localStorage.getItem(REGISTERED_KEY),"1");
}

// P1-B1: server revoke fails, local unregister succeeds => retry metadata is preserved.
seedNativeState();
{
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{throw new Error("backend unavailable");},
    unregister:async()=>{}
  }));
  assert.equal(result.serverRevoked,false);
  assert.equal(result.localUnregistered,true);
  assert.equal(result.cleanupPending,true);
  assert.equal(result.cleanupComplete,false);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),INSTALLATION);
  assert.equal(localStorage.getItem(OWNER_KEY),"A");
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
  assert.deepEqual(pendingState(),{installationId:INSTALLATION,ownerId:"A",serverRevoked:false,localUnregistered:true});
}

// P1-B2: server revoke succeeds, local unregister fails => not falsely fully cleaned.
seedNativeState();
{
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{},
    unregister:async()=>{throw new Error("native failure");}
  }));
  assert.equal(result.serverRevoked,true);
  assert.equal(result.localUnregistered,false);
  assert.equal(result.cleanupPending,true);
  assert.equal(result.cleanupComplete,false);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),INSTALLATION);
  assert.equal(localStorage.getItem(REGISTERED_KEY),"1");
  assert.deepEqual(pendingState(),{installationId:INSTALLATION,ownerId:"A",serverRevoked:true,localUnregistered:false});
}

// P1-B3/B4/B5: dual failure retains metadata; later retry succeeds; repeated retry is idempotent.
seedNativeState();
{
  let serverCalls=0;
  let unregisterCalls=0;
  const failed=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{serverCalls++;throw new Error("server down");},
    unregister:async()=>{unregisterCalls++;throw new Error("local down");}
  }));
  assert.equal(failed.cleanupPending,true);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),INSTALLATION);
  assert.equal(localStorage.getItem(REGISTERED_KEY),"1");
  assert.deepEqual(pendingState(),{installationId:INSTALLATION,ownerId:"A",serverRevoked:false,localUnregistered:false});

  const recovered=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{serverCalls++;},
    unregister:async()=>{unregisterCalls++;}
  }));
  assert.equal(recovered.cleanupComplete,true);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);

  const repeated=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{serverCalls++;},
    unregister:async()=>{unregisterCalls++;}
  }));
  assert.equal(repeated.hadCredential,false);
  assert.equal(repeated.cleanupComplete,true);
  assert.equal(serverCalls,2);
  assert.equal(unregisterCalls,2);
}

// Session expiry records owner metadata even though the expired token is not reused.
seedNativeState();
{
  let cleanupToken="not-called";
  let cleanupOwner="";
  const result=await expireAuthenticatedSession({
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-disabled"}),
    nativeCleanup:async(token,options)=>{
      cleanupToken=token;
      cleanupOwner=options?.ownerId||"";
      return {serverRevoked:false,localUnregistered:true,hadCredential:true,cleanupPending:true,cleanupComplete:false,native:true};
    },
    logger:{warn(){}}
  });
  assert.equal(cleanupToken,"");
  assert.equal(cleanupOwner,"A");
  assert.equal(result.cleanupPending,true);
  assert.equal(localStorage.getItem(AUTH_KEY),null);
  assert.deepEqual(sessionEvents,["seago:session-expired"]);
}

// P1-C1/C2/C4/C6: Android + push disabled/configless + no credential => auth succeeds and unregister is never called.
localStorage.clear();
{
  let cleanupCalls=0;
  const result=await reconcileAuthPush({token:"auth-fresh",user:{id:"fresh"}},{
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-disabled"}),
    nativeState:()=>nativePushCleanupState(),
    nativeCleanup:async()=>{cleanupCalls++;throw new Error("must not be called");}
  });
  assert.equal(result.token,"auth-fresh");
  assert.equal(cleanupCalls,0);

  let unregisterCalls=0;
  const noCredentialCleanup=await disableNativePush("",nativeCleanupOptions({
    ownerId:"",
    serverUnsubscribe:async()=>{throw new Error("must not be called");},
    unregister:async()=>{unregisterCalls++;throw new Error("configless unregister must not run");}
  }));
  assert.equal(noCredentialCleanup.hadCredential,false);
  assert.equal(noCredentialCleanup.cleanupComplete,true);
  assert.equal(unregisterCalls,0);
}

// P1-C3: a real prior credential still forces cleanup using the old account token.
seedNativeState();
{
  let cleanupCalls=0;
  const result=await reconcileAuthPush({token:"auth-B",user:{id:"B"}},{
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-disabled"}),
    nativeState:()=>nativePushCleanupState(),
    nativeCleanup:async(token,options)=>{
      cleanupCalls++;
      assert.equal(token,"auth-A");
      assert.equal(options?.ownerId,"A");
      return disableNativePush(token,nativeCleanupOptions({serverUnsubscribe:async()=>{},unregister:async()=>{},ownerId:"A"}));
    }
  });
  assert.equal(result.token,"auth-B");
  assert.equal(cleanupCalls,1);
  assert.equal(nativePushCleanupState().hadCredential,false);
}

// P1-C5: pending cleanup is retried with a new token only when it is the same owner.
seedNativeState();
await disableNativePush("auth-A",nativeCleanupOptions({
  serverUnsubscribe:async()=>{throw new Error("temporary server failure");},
  unregister:async()=>{}
}));
localStorage.removeItem(AUTH_KEY);
{
  let retryAuth="";
  const result=await reconcileAuthPush({token:"auth-A2",user:{id:"A"}},{
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-disabled"}),
    nativeState:()=>nativePushCleanupState(),
    nativeCleanup:(token,options)=>{
      retryAuth=token;
      return disableNativePush(token,nativeCleanupOptions({serverUnsubscribe:async()=>{},unregister:async()=>{},ownerId:options?.ownerId}));
    }
  });
  assert.equal(retryAuth,"auth-A2");
  assert.equal(result.token,"auth-A2");
  assert.equal(nativePushCleanupState().hadCredential,false);
}

// Different-account auth cannot use B to revoke A's pending server credential.
seedNativeState();
await disableNativePush("auth-A",nativeCleanupOptions({
  serverUnsubscribe:async()=>{throw new Error("temporary server failure");},
  unregister:async()=>{}
}));
localStorage.removeItem(AUTH_KEY);
{
  let serverAuth="not-called";
  await assert.rejects(
    reconcileAuthPush({token:"auth-B",user:{id:"B"}},{
      runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-disabled"}),
      nativeState:()=>nativePushCleanupState(),
      nativeCleanup:(token,options)=>disableNativePush(token,nativeCleanupOptions({
        ownerId:options?.ownerId,
        serverUnsubscribe:async(_id,auth)=>{serverAuth=auth;},
        unregister:async()=>{}
      }))
    }),
    /Native notification credential cleanup failed/
  );
  assert.equal(serverAuth,"not-called");
  assert.equal(pendingState().serverRevoked,false);
}

// No raw token or provider error content is emitted to logs.
seedNativeState();
{
  const rawToken="raw-fcm-token-that-must-never-appear-in-logs";
  const logs=[];
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{throw new Error(`backend echoed ${rawToken}`);},
    unregister:async()=>{throw new Error(`provider echoed ${rawToken}`);},
    logger:{warn:value=>logs.push(String(value))}
  }));
  assert.equal(result.cleanupPending,true);
  assert.equal(JSON.stringify(logs).includes(rawToken),false);
  assert.deepEqual(logs,["Native push local unregister failed"]);
}

// Behavioral smoke for register/login/Google auth paths with native push disabled and no prior credential.
// A temporary module copy injects only a test API base; production logic is otherwise executed unchanged.
localStorage.clear();
{
  const sourceUrl=new URL("../src/api.js",import.meta.url);
  const tempUrl=new URL("../src/.api-native-push-auth-test.mjs",import.meta.url);
  const source=await readFile(sourceUrl,"utf8");
  const configured=source.replace(
    'const API_BASE = String((import.meta.env && import.meta.env.VITE_API_BASE_URL) || "").replace(/\\\/$/, "");',
    'const API_BASE = "https://native-push-auth.test";'
  );
  assert.notEqual(configured,source);
  await writeFile(tempUrl,configured,"utf8");

  const originalNative=Capacitor.isNativePlatform;
  const originalPlatform=Capacitor.getPlatform;
  const originalFetch=globalThis.fetch;
  try{
    Capacitor.isNativePlatform=()=>true;
    Capacitor.getPlatform=()=>"android";
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({token:"auth-fresh",user:{id:"fresh"}})});
    const authApi=await import(`${pathToFileURL(fileURLToPath(tempUrl)).href}?v=${Date.now()}`);
    const registered=await authApi.registerCustomer({name:"Fresh",email:"fresh@example.com",phone:"",password:"password123"});
    const loggedIn=await authApi.loginCustomer({email:"fresh@example.com",password:"password123"});
    const google=await authApi.googleSignIn("google-credential","customer");
    assert.equal(registered.token,"auth-fresh");
    assert.equal(loggedIn.token,"auth-fresh");
    assert.equal(google.token,"auth-fresh");
  }finally{
    Capacitor.isNativePlatform=originalNative;
    Capacitor.getPlatform=originalPlatform;
    globalThis.fetch=originalFetch;
    await unlink(tempUrl).catch(()=>{});
  }
}

console.log("native push lifecycle behavioral tests passed");
