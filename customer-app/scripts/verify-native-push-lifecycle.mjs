import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Capacitor } from "@capacitor/core";
import { disableNativePush, enableNativePush, nativePushCleanupState } from "../src/nativePush.js";
import { expireAuthenticatedSession, reconcileAuthPush } from "../src/api.js";
import { revokeCurrentNotificationCredentials } from "../src/notificationCredentialLifecycle.js";

const INSTALLATION_KEY="seago_native_installation_id";
const EPOCH_KEY="seago_native_push_lifecycle_epoch";
const REGISTERED_KEY="seago_native_push_registered";
const OWNER_KEY="seago_native_push_owner_id";
const CLEANUP_PENDING_KEY="seago_native_push_cleanup_pending";
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

function deferred(){
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function settlesWithin(promise,ms=250){
  return Promise.race([
    promise,
    delay(ms).then(()=>{throw new Error("operation did not settle before guard timeout");})
  ]);
}

function seedAuth(owner="A",token=`auth-${owner}`){
  localStorage.setItem(AUTH_KEY,JSON.stringify({token,user:{id:owner}}));
}

function seedNativeState({authToken="auth-A",ownerId="A",registered=true,lifecycleEpoch=1}={}){
  localStorage.clear();
  localStorage.setItem(INSTALLATION_KEY,INSTALLATION);
  localStorage.setItem(EPOCH_KEY,String(lifecycleEpoch));
  if(registered)localStorage.setItem(REGISTERED_KEY,"1");
  if(ownerId)localStorage.setItem(OWNER_KEY,ownerId);
  if(authToken)localStorage.setItem(AUTH_KEY,JSON.stringify({token:authToken,user:{id:ownerId||"A"}}));
  sessionEvents.length=0;
}

function pendingState(){
  const raw=localStorage.getItem(CLEANUP_PENDING_KEY);
  return raw?JSON.parse(raw):null;
}

function successfulRevoke({expectedEpoch}={}){
  return async ({lifecycleEpoch},auth)=>{
    if(expectedEpoch!==undefined)assert.equal(lifecycleEpoch,expectedEpoch);
    assert.ok(auth);
    return {ok:true,revoked:true,lifecycleEpoch:lifecycleEpoch+1};
  };
}

function nativeCleanupOptions({serverUnsubscribe,unregister,logger,ownerId="A",settlementTimeoutMs=20,revokeTimeoutMs=100}={}){
  return {
    native:true,
    android:true,
    ownerId,
    settlementTimeoutMs,
    revokeTimeoutMs,
    serverUnsubscribe:serverUnsubscribe||successfulRevoke(),
    pushNotifications:{unregister:unregister||(async()=>{})},
    logger:logger||{warn(){}}
  };
}

function fakePushHarness(){
  const listeners=new Map();
  return {
    listeners,
    push:{
      checkPermissions:async()=>({receive:"granted"}),
      requestPermissions:async()=>({receive:"granted"}),
      addListener:async(name,callback)=>{
        listeners.set(name,callback);
        return {remove:async()=>{listeners.delete(name);}};
      },
      register:async()=>{},
      unregister:async()=>{}
    }
  };
}

// Existing logout path still fences the server before local unregister and records the returned next epoch.
seedNativeState();
{
  const order=[];
  const settled=await revokeCurrentNotificationCredentials("auth-A",{
    androidNative:true,
    disableNotifications:token=>disableNativePush(token,nativeCleanupOptions({
      serverUnsubscribe:async ({installationId,lifecycleEpoch},auth)=>{
        assert.equal(installationId,INSTALLATION);
        assert.equal(lifecycleEpoch,1);
        assert.equal(auth,"auth-A");
        order.push("server");
        return {lifecycleEpoch:2};
      },
      unregister:async()=>{order.push("unregister");}
    }))
  });
  assert.equal(settled[0].status,"fulfilled");
  assert.equal(settled[0].value.cleanupComplete,true);
  assert.equal(settled[0].value.fenceConfirmed,true);
  assert.deepEqual(order,["server","unregister"]);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
}

// P1-A/P1-B: a delayed old subscribe is rejected by the server epoch; no compensating revoke is security-critical.
localStorage.clear();
seedAuth("A","auth-A");
{
  const {push,listeners}=fakePushHarness();
  const subscribeStarted=deferred();
  const releaseSubscribe=deferred();
  let serverEpoch=1;
  let serverActive=false;
  let unsubscribeCalls=0;
  const serverSubscribe=async ({lifecycleEpoch})=>{
    subscribeStarted.resolve();
    await releaseSubscribe.promise;
    if(lifecycleEpoch!==serverEpoch){
      const error=new Error("stale lifecycle");
      error.status=410;
      throw error;
    }
    serverActive=true;
    return {lifecycleEpoch};
  };
  const serverUnsubscribe=async ({lifecycleEpoch})=>{
    unsubscribeCalls++;
    if(lifecycleEpoch===serverEpoch){
      serverEpoch++;
      serverActive=false;
      return {lifecycleEpoch:serverEpoch};
    }
    if(lifecycleEpoch+1===serverEpoch&&!serverActive)return {lifecycleEpoch:serverEpoch};
    throw new Error("unexpected epoch");
  };

  await enableNativePush("auth-A",{
    enabled:true,pushNotifications:push,serverSubscribe,platform:"android",ownerId:"A",logger:{warn(){}}
  });
  listeners.get("registration")({value:"raw-fcm-token-for-race-test-1234567890"});
  await subscribeStarted.promise;

  const cleanup=await settlesWithin(disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe,unregister:async()=>{},settlementTimeoutMs:10
  })));
  assert.equal(cleanup.cleanupComplete,true);
  assert.equal(cleanup.serverRevoked,true);
  assert.equal(serverEpoch,2);
  assert.equal(serverActive,false);
  assert.equal(unsubscribeCalls,1);

  releaseSubscribe.resolve();
  await delay(0);
  await delay(0);
  assert.equal(serverActive,false);
  assert.equal(unsubscribeCalls,1);
  assert.equal(localStorage.getItem(REGISTERED_KEY),null);
}

// Server revoke failure cannot be converted into cleanupComplete by stale local state.
seedNativeState();
{
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{throw new Error("backend unavailable");},
    unregister:async()=>{}
  }));
  assert.equal(result.serverRevoked,false);
  assert.equal(result.fenceConfirmed,false);
  assert.equal(result.localUnregistered,true);
  assert.equal(result.cleanupPending,true);
  assert.equal(result.cleanupComplete,false);
  const pending=pendingState();
  assert.equal(pending.lifecycleEpoch,1);
  assert.equal(pending.fenceConfirmed,false);
  assert.equal(pending.serverRevoked,false);
}

// A legacy/stale serverRevoked=true boolean without the new fence confirmation is never trusted.
seedNativeState();
localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify({
  installationId:INSTALLATION,ownerId:"A",serverRevoked:true,localUnregistered:true
}));
{
  let revokeCalls=0;
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async ({lifecycleEpoch})=>{revokeCalls++;return {lifecycleEpoch:lifecycleEpoch+1};},
    unregister:async()=>{throw new Error("must not run because local state was already unregistered");}
  }));
  assert.equal(revokeCalls,1);
  assert.equal(result.cleanupComplete,true);
  assert.equal(result.fenceConfirmed,true);
}

// Server fence succeeds while local unregister fails: cleanup remains pending, but fence truth is durable.
seedNativeState();
{
  const result=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:successfulRevoke({expectedEpoch:1}),
    unregister:async()=>{throw new Error("native failure");}
  }));
  assert.equal(result.serverRevoked,true);
  assert.equal(result.fenceConfirmed,true);
  assert.equal(result.localUnregistered,false);
  assert.equal(result.cleanupPending,true);
  assert.equal(result.cleanupComplete,false);
  const pending=pendingState();
  assert.equal(pending.lifecycleEpoch,1);
  assert.equal(pending.nextLifecycleEpoch,2);
  assert.equal(pending.fenceConfirmed,true);
  assert.equal(pending.serverRevoked,true);
  assert.equal(localStorage.getItem(EPOCH_KEY),"2");
}

// Dual failure retains metadata; a same-owner retry can establish the fence and complete cleanup.
seedNativeState();
{
  let serverCalls=0;
  let unregisterCalls=0;
  const failed=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{serverCalls++;throw new Error("server down");},
    unregister:async()=>{unregisterCalls++;throw new Error("local down");}
  }));
  assert.equal(failed.cleanupPending,true);
  assert.equal(failed.fenceConfirmed,false);

  const recovered=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async ({lifecycleEpoch})=>{serverCalls++;return {lifecycleEpoch:lifecycleEpoch+1};},
    unregister:async()=>{unregisterCalls++;}
  }));
  assert.equal(recovered.cleanupComplete,true);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
  assert.equal(serverCalls,2);
  assert.equal(unregisterCalls,2);

  const repeated=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async()=>{serverCalls++;throw new Error("must not run");},
    unregister:async()=>{unregisterCalls++;throw new Error("must not run");}
  }));
  assert.equal(repeated.hadCredential,false);
  assert.equal(repeated.cleanupComplete,true);
  assert.equal(serverCalls,2);
  assert.equal(unregisterCalls,2);
}

// P1-C: native subscribe 401 schedules expiry after the registration task leaves the in-flight set.
localStorage.clear();
seedAuth("A","auth-A");
{
  const {push,listeners}=fakePushHarness();
  const expiryDone=deferred();
  let expiryCalls=0;
  const unauthorized=new Error("expired");
  unauthorized.status=401;
  await enableNativePush("auth-A",{
    enabled:true,
    pushNotifications:push,
    serverSubscribe:async()=>{throw unauthorized;},
    platform:"android",
    ownerId:"A",
    sessionExpiry:async()=>{
      expiryCalls++;
      const result=await disableNativePush("",nativeCleanupOptions({
        ownerId:"A",
        serverUnsubscribe:async()=>{throw new Error("must not use expired auth");},
        unregister:async()=>{},
        settlementTimeoutMs:1000
      }));
      expiryDone.resolve(result);
      return result;
    },
    logger:{warn(){}}
  });
  listeners.get("registration")({value:"raw-fcm-token-401-test-1234567890"});
  const result=await settlesWithin(expiryDone.promise,250);
  assert.equal(expiryCalls,1);
  assert.equal(result.cleanupPending,true);
  assert.equal(result.localUnregistered,true);
}

// A hung subscribe cannot block logout forever; successful server fence is the security boundary.
localStorage.clear();
seedAuth("A","auth-A");
{
  const {push,listeners}=fakePushHarness();
  const started=deferred();
  const never=new Promise(()=>{});
  await enableNativePush("auth-A",{
    enabled:true,
    pushNotifications:push,
    serverSubscribe:async()=>{started.resolve();return never;},
    platform:"android",
    ownerId:"A",
    logger:{warn(){}}
  });
  listeners.get("registration")({value:"raw-fcm-token-hung-test-1234567890"});
  await started.promise;
  const result=await settlesWithin(disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:successfulRevoke({expectedEpoch:1}),
    unregister:async()=>{},
    settlementTimeoutMs:15
  })),250);
  assert.equal(result.cleanupComplete,true);
  assert.equal(result.fenceConfirmed,true);
  assert.equal(localStorage.getItem(INSTALLATION_KEY),null);
}

// Restart durability: lost revoke response leaves pending epoch N; a fresh module retries N and accepts idempotent N+1.
seedNativeState();
{
  const serverEpoch=2;
  const first=await disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async ({lifecycleEpoch})=>{
      assert.equal(lifecycleEpoch,1);
      throw new Error("response lost after server committed the fence");
    },
    unregister:async()=>{}
  }));
  assert.equal(first.cleanupComplete,false);
  assert.equal(first.serverRevoked,false);
  assert.equal(pendingState().lifecycleEpoch,1);

  const restarted=await import(`${pathToFileURL(fileURLToPath(new URL("../src/nativePush.js",import.meta.url))).href}?restart=${Date.now()}`);
  const recoveredState=restarted.nativePushCleanupState();
  assert.equal(recoveredState.cleanupPending,true);
  assert.equal(recoveredState.lifecycleEpoch,1);
  const retry=await restarted.disableNativePush("auth-A",nativeCleanupOptions({
    serverUnsubscribe:async ({lifecycleEpoch})=>{
      assert.equal(lifecycleEpoch,1);
      assert.equal(serverEpoch,2);
      return {lifecycleEpoch:serverEpoch};
    },
    unregister:async()=>{throw new Error("local unregister was already persisted");}
  }));
  assert.equal(retry.cleanupComplete,true);
  assert.equal(retry.nextLifecycleEpoch,2);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
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

// Prior P1-C regression: Android push disabled/configless + no prior credential does not block authentication.
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

// A real prior credential still forces cleanup using the old account token.
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
      return disableNativePush(token,nativeCleanupOptions({serverUnsubscribe:successfulRevoke({expectedEpoch:1}),unregister:async()=>{},ownerId:"A"}));
    }
  });
  assert.equal(result.token,"auth-B");
  assert.equal(cleanupCalls,1);
  assert.equal(nativePushCleanupState().hadCredential,false);
}

// Pending cleanup is retried with a new token only when it belongs to the same owner.
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
      return disableNativePush(token,nativeCleanupOptions({serverUnsubscribe:successfulRevoke({expectedEpoch:1}),unregister:async()=>{},ownerId:options?.ownerId}));
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
        serverUnsubscribe:async(_payload,auth)=>{serverAuth=auth;return {lifecycleEpoch:2};},
        unregister:async()=>{}
      }))
    }),
    /Native notification credential cleanup failed/
  );
  assert.equal(serverAuth,"not-called");
  assert.equal(pendingState().serverRevoked,false);
  assert.equal(pendingState().fenceConfirmed,false);
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
