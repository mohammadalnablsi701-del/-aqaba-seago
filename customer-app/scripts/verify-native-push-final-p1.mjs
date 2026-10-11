import assert from "node:assert/strict";
import { reconcileAuthPush, expireAuthenticatedSession } from "../src/api.js";
import { revokeCurrentNotificationCredentials } from "../src/notificationCredentialLifecycle.js";

const INSTALLATION_KEY="seago_native_installation_id";
const EPOCH_KEY="seago_native_push_lifecycle_epoch";
const REGISTERED_KEY="seago_native_push_registered";
const OWNER_KEY="seago_native_push_owner_id";
const CLEANUP_PENDING_KEY="seago_native_push_cleanup_pending";
const AUTH_KEY="seago_auth";
let importCounter=0;

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

const never=()=>new Promise(()=>{});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settlesWithin(promise,ms=250){
  return Promise.race([
    promise,
    delay(ms).then(()=>{throw new Error("operation did not settle before guard timeout");})
  ]);
}
async function freshNative(){
  importCounter++;
  return import(`../src/nativePush.js?final-p1=${importCounter}`);
}
function seed({
  installationId="final-p1-installation",
  ownerId="A",
  authToken="auth-A",
  lifecycleEpoch=1,
  registered=true,
  pending=null
}={}){
  localStorage.clear();
  localStorage.setItem(INSTALLATION_KEY,installationId);
  localStorage.setItem(EPOCH_KEY,String(lifecycleEpoch));
  if(ownerId)localStorage.setItem(OWNER_KEY,ownerId);
  if(registered)localStorage.setItem(REGISTERED_KEY,"1");
  if(authToken)localStorage.setItem(AUTH_KEY,JSON.stringify({token:authToken,user:{id:ownerId}}));
  if(pending)localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify(pending));
  sessionEvents.length=0;
}
function options({
  serverUnsubscribe=async ({lifecycleEpoch})=>({lifecycleEpoch:lifecycleEpoch+1}),
  unregister=async()=>{},
  ownerId="A",
  logger={warn(){}},
  unregisterTimeoutMs=15,
  listenerCleanupTimeoutMs=15,
  revokeTimeoutMs=15,
  settlementTimeoutMs=10,
  pushNotifications
}={}){
  return {
    native:true,
    android:true,
    ownerId,
    serverUnsubscribe,
    pushNotifications:pushNotifications||{unregister},
    unregisterTimeoutMs,
    listenerCleanupTimeoutMs,
    revokeTimeoutMs,
    settlementTimeoutMs,
    logger
  };
}

// Persisted fence booleans are hints only. A fresh module must not trust them.
seed({
  lifecycleEpoch:8,
  pending:{
    installationId:"final-p1-installation",
    ownerId:"A",
    lifecycleEpoch:7,
    nextLifecycleEpoch:8,
    fenceConfirmed:true,
    serverRevoked:true,
    localUnregistered:true
  }
});
{
  const native=await freshNative();
  const recovered=native.nativePushCleanupState();
  assert.equal(recovered.serverFenceWasConfirmedPreviously,true);
  assert.equal(recovered.fenceConfirmed,false);
  assert.equal(recovered.serverRevoked,false);
  let calls=0;
  const result=await settlesWithin(native.disableNativePush("auth-A",options({
    serverUnsubscribe:async()=>{calls++;throw new Error("backend unavailable");}
  })));
  assert.equal(calls,1);
  assert.equal(result.cleanupComplete,false);
  assert.equal(result.fenceConfirmed,false);
  assert.notEqual(localStorage.getItem(CLEANUP_PENDING_KEY),null);
  const persisted=JSON.parse(localStorage.getItem(CLEANUP_PENDING_KEY));
  assert.equal(Object.hasOwn(persisted,"fenceConfirmed"),false);
  assert.equal(Object.hasOwn(persisted,"serverRevoked"),false);
}

// Corrupted/stale persisted confirmation clears only after a fresh server response.
seed({
  lifecycleEpoch:8,
  pending:{
    installationId:"final-p1-installation",
    ownerId:"A",
    lifecycleEpoch:7,
    nextLifecycleEpoch:8,
    fenceConfirmed:true,
    serverRevoked:true,
    localUnregistered:true
  }
});
{
  const native=await freshNative();
  let calls=0;
  const result=await settlesWithin(native.disableNativePush("auth-A",options({
    serverUnsubscribe:async ({lifecycleEpoch},auth)=>{
      calls++;
      assert.equal(lifecycleEpoch,7);
      assert.equal(auth,"auth-A");
      return {lifecycleEpoch:8};
    }
  })));
  assert.equal(calls,1);
  assert.equal(result.fenceConfirmed,true);
  assert.equal(result.serverRevoked,true);
  assert.equal(result.cleanupComplete,true);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
}

// Lost response remains recoverable: restart retries N and accepts idempotent N+1.
seed();
{
  const firstNative=await freshNative();
  const first=await settlesWithin(firstNative.disableNativePush("auth-A",options({
    serverUnsubscribe:async ({lifecycleEpoch})=>{
      assert.equal(lifecycleEpoch,1);
      throw new Error("response lost after commit");
    },
    unregister:async()=>{}
  })));
  assert.equal(first.cleanupComplete,false);
  assert.equal(JSON.parse(localStorage.getItem(CLEANUP_PENDING_KEY)).lifecycleEpoch,1);

  const restarted=await freshNative();
  assert.equal(restarted.nativePushCleanupState().fenceConfirmed,false);
  const recovered=await settlesWithin(restarted.disableNativePush("auth-A",options({
    serverUnsubscribe:async ({lifecycleEpoch})=>{
      assert.equal(lifecycleEpoch,1);
      return {lifecycleEpoch:2};
    },
    unregister:async()=>{throw new Error("already locally unregistered");}
  })));
  assert.equal(recovered.cleanupComplete,true);
  assert.equal(recovered.nextLifecycleEpoch,2);
}

// B cannot use B's credential to verify or revoke A's persisted recovery state.
seed({
  authToken:"auth-B",
  ownerId:"A",
  pending:{
    installationId:"final-p1-installation",
    ownerId:"A",
    lifecycleEpoch:4,
    nextLifecycleEpoch:5,
    fenceConfirmed:true,
    serverRevoked:true,
    localUnregistered:true
  }
});
localStorage.setItem(AUTH_KEY,JSON.stringify({token:"auth-B",user:{id:"B"}}));
{
  const native=await freshNative();
  let serverCalls=0;
  const result=await settlesWithin(native.disableNativePush("auth-B",options({
    ownerId:"B",
    serverUnsubscribe:async()=>{serverCalls++;return {lifecycleEpoch:5};}
  })));
  assert.equal(serverCalls,0);
  assert.equal(result.cleanupComplete,false);
  assert.equal(result.fenceConfirmed,false);
  assert.notEqual(localStorage.getItem(CLEANUP_PENDING_KEY),null);
}

// A fresh server confirmation is authoritative in-memory and is not re-revoked forever in one lifecycle.
seed();
{
  const native=await freshNative();
  let serverCalls=0;
  const first=await settlesWithin(native.disableNativePush("auth-A",options({
    serverUnsubscribe:async ({lifecycleEpoch})=>{serverCalls++;return {lifecycleEpoch:lifecycleEpoch+1};},
    unregister:async()=>{throw new Error("temporary native failure");}
  })));
  assert.equal(first.fenceConfirmed,true);
  assert.equal(first.cleanupComplete,false);
  assert.equal(native.nativePushCleanupState().fenceConfirmed,true);

  const second=await settlesWithin(native.disableNativePush("auth-A",options({
    serverUnsubscribe:async()=>{serverCalls++;throw new Error("must not repeat in same lifecycle");},
    unregister:async()=>{}
  })));
  assert.equal(serverCalls,1);
  assert.equal(second.cleanupComplete,true);
}

// unregister() can hang forever at the bridge; cleanup cannot.
seed();
{
  const native=await freshNative();
  const logs=[];
  const result=await settlesWithin(native.disableNativePush("auth-A",options({
    unregister:never,
    logger:{warn:value=>logs.push(String(value))}
  })));
  assert.equal(result.serverRevoked,true);
  assert.equal(result.fenceConfirmed,true);
  assert.equal(result.localUnregistered,false);
  assert.equal(result.cleanupComplete,false);
  assert.equal(result.cleanupPending,true);
  assert.deepEqual(logs,["Native push local unregister timed out"]);
}

// listener.remove() can hang forever; all individual removals are bounded.
localStorage.clear();
localStorage.setItem(AUTH_KEY,JSON.stringify({token:"auth-A",user:{id:"A"}}));
{
  const native=await freshNative();
  const logs=[];
  const push={
    checkPermissions:async()=>({receive:"granted"}),
    requestPermissions:async()=>({receive:"granted"}),
    addListener:async()=>({remove:never}),
    register:async()=>{},
    unregister:async()=>{}
  };
  await native.enableNativePush("auth-A",{
    enabled:true,
    pushNotifications:push,
    serverSubscribe:async (_payload)=>({lifecycleEpoch:1}),
    platform:"android",
    ownerId:"A",
    listenerCleanupTimeoutMs:15,
    logger:{warn:value=>logs.push(String(value))}
  });
  const result=await settlesWithin(native.disableNativePush("auth-A",options({
    pushNotifications:push,
    logger:{warn:value=>logs.push(String(value))}
  })));
  assert.equal(result.cleanupComplete,true);
  assert.ok(logs.includes("Native push listener cleanup timed out"));
}

// If neither server fence nor native unregister settles, failure is bounded and never reported as success.
seed();
{
  const native=await freshNative();
  const result=await settlesWithin(native.disableNativePush("auth-A",options({
    serverUnsubscribe:never,
    unregister:never
  })));
  assert.equal(result.serverRevoked,false);
  assert.equal(result.fenceConfirmed,false);
  assert.equal(result.localUnregistered,false);
  assert.equal(result.cleanupComplete,false);
  assert.equal(result.cleanupPending,true);
}

// Shared register/login/Google reconciliation path is bounded by disableNativePush even with a hung native bridge.
for(const pathName of ["register","login","google"]){
  seed({installationId:`final-p1-${pathName}`});
  const native=await freshNative();
  await assert.rejects(
    settlesWithin(reconcileAuthPush({token:"auth-A2",user:{id:"A"}},{
      runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
      nativeState:()=>native.nativePushCleanupState(),
      nativeCleanup:(token,{ownerId})=>native.disableNativePush(token,options({
        ownerId,
        unregister:never
      }))
    })),
    /Native notification credential cleanup failed/
  );
}

// Account switch remains bounded while the old A credential is cleaned with A, never B.
seed({installationId:"final-p1-switch"});
{
  const native=await freshNative();
  let serverAuth="";
  await assert.rejects(
    settlesWithin(reconcileAuthPush({token:"auth-B",user:{id:"B"}},{
      runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
      nativeState:()=>native.nativePushCleanupState(),
      nativeCleanup:(token,{ownerId})=>native.disableNativePush(token,options({
        ownerId,
        serverUnsubscribe:async ({lifecycleEpoch},auth)=>{
          serverAuth=auth;
          return {lifecycleEpoch:lifecycleEpoch+1};
        },
        unregister:never
      }))
    })),
    /Native notification credential cleanup failed/
  );
  assert.equal(serverAuth,"auth-A");
}

// Session expiry has a finite native-cleanup path even when unregister never settles.
seed({installationId:"final-p1-expiry"});
{
  const native=await freshNative();
  const result=await settlesWithin(expireAuthenticatedSession({
    runtimeContext:async()=>({isNative:true,platform:"android",channel:"native-android"}),
    nativeCleanup:(token,{ownerId})=>native.disableNativePush(token,options({
      ownerId,
      serverUnsubscribe:never,
      unregister:never
    })),
    logger:{warn(){}}
  }));
  assert.equal(result.cleanupComplete,false);
  assert.equal(result.cleanupPending,true);
  assert.deepEqual(sessionEvents,["seago:session-expired"]);
}

// Logout cleanup is also bounded when the native bridge never settles.
seed({installationId:"final-p1-logout"});
{
  const native=await freshNative();
  const settled=await settlesWithin(revokeCurrentNotificationCredentials("auth-A",{
    androidNative:true,
    disableNotifications:token=>native.disableNativePush(token,options({unregister:never}))
  }));
  assert.equal(settled.length,1);
  assert.equal(settled[0].status,"fulfilled");
  assert.equal(settled[0].value.cleanupComplete,false);
}

console.log("native push final P1 behavioral tests passed");
