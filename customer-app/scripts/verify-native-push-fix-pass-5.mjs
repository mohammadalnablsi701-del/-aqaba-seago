import assert from "node:assert/strict";

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
globalThis.window={dispatchEvent:()=>true};
if(typeof globalThis.CustomEvent==="undefined")globalThis.CustomEvent=class CustomEvent{constructor(type){this.type=type;}};

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settlesWithin(promise,ms=250){
  return Promise.race([
    promise,
    delay(ms).then(()=>{throw new Error("operation did not settle before guard timeout");})
  ]);
}
async function freshNative(){
  importCounter++;
  return import(`../src/nativePush.js?fix-pass-5=${importCounter}`);
}
function setAuth(ownerId,token=`auth-${ownerId}`){
  if(!ownerId){
    localStorage.removeItem(AUTH_KEY);
    return;
  }
  localStorage.setItem(AUTH_KEY,JSON.stringify({token,user:{id:ownerId}}));
}
function seed({
  installationId="fix-pass-5-installation",
  ownerId="A",
  lifecycleEpoch=1,
  registered=true,
  pending=null,
  authOwner=ownerId
}={}){
  localStorage.clear();
  if(installationId)localStorage.setItem(INSTALLATION_KEY,installationId);
  if(lifecycleEpoch)localStorage.setItem(EPOCH_KEY,String(lifecycleEpoch));
  if(ownerId)localStorage.setItem(OWNER_KEY,ownerId);
  if(registered)localStorage.setItem(REGISTERED_KEY,"1");
  if(pending)localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify(pending));
  setAuth(authOwner);
}
function options({
  ownerId="A",
  serverUnsubscribe=async ({lifecycleEpoch})=>({lifecycleEpoch:lifecycleEpoch+1}),
  unregister=async()=>{}
}={}){
  return {
    native:true,
    android:true,
    ownerId,
    serverUnsubscribe,
    pushNotifications:{unregister},
    unregisterTimeoutMs:15,
    listenerCleanupTimeoutMs:15,
    revokeTimeoutMs:15,
    settlementTimeoutMs:10,
    logger:{warn(){}}
  };
}

// Ownerless persisted recovery state is never authority, even with stale success hints.
seed({
  ownerId:"",
  authOwner:"A",
  lifecycleEpoch:8,
  pending:{
    installationId:"fix-pass-5-installation",
    ownerId:"",
    lifecycleEpoch:7,
    nextLifecycleEpoch:8,
    serverFenceWasConfirmedPreviously:true,
    fenceConfirmed:true,
    serverRevoked:true,
    localUnregistered:true
  }
});
// Even a stale standalone owner hint must not backfill an ownerless pending cleanup.
localStorage.setItem(OWNER_KEY,"A");
{
  const native=await freshNative();
  const {fenceAuthorityKey}=native.nativePushLifecycleInternals;
  assert.equal(fenceAuthorityKey({installationId:"X",ownerId:"",lifecycleEpoch:7,nextLifecycleEpoch:8}),"");
  assert.equal(fenceAuthorityKey({installationId:"X",ownerId:"   ",lifecycleEpoch:7,nextLifecycleEpoch:8}),"");
  assert.equal(fenceAuthorityKey({installationId:"",ownerId:"A",lifecycleEpoch:7,nextLifecycleEpoch:8}),"");
  assert.equal(fenceAuthorityKey({installationId:"X",ownerId:"A",lifecycleEpoch:0,nextLifecycleEpoch:1}),"");
  assert.equal(fenceAuthorityKey({installationId:"X",ownerId:"A",lifecycleEpoch:7,nextLifecycleEpoch:9}),"");

  const before=native.nativePushCleanupState({ownerId:"A"});
  assert.equal(before.ownerId,"");
  assert.equal(before.serverFenceWasConfirmedPreviously,true);
  assert.equal(before.fenceConfirmed,false);
  assert.equal(before.serverRevoked,false);

  let serverCalls=0;
  const result=await settlesWithin(native.disableNativePush("auth-A",options({
    ownerId:"A",
    serverUnsubscribe:async()=>{serverCalls++;return {lifecycleEpoch:8};}
  })));
  assert.equal(serverCalls,0);
  assert.equal(result.cleanupComplete,false);
  assert.equal(result.fenceConfirmed,false);
  assert.notEqual(localStorage.getItem(CLEANUP_PENDING_KEY),null);
  assert.equal(JSON.parse(localStorage.getItem(CLEANUP_PENDING_KEY)).ownerId,"");
}

// Fresh A confirmation creates authority only for the exact A/X/N->N+1 transition.
seed();
{
  const native=await freshNative();
  let serverCalls=0;
  const first=await settlesWithin(native.disableNativePush("auth-A",options({
    ownerId:"A",
    serverUnsubscribe:async ({installationId,lifecycleEpoch},auth)=>{
      serverCalls++;
      assert.equal(installationId,"fix-pass-5-installation");
      assert.equal(lifecycleEpoch,1);
      assert.equal(auth,"auth-A");
      return {lifecycleEpoch:2};
    },
    unregister:async()=>{throw new Error("keep cleanup pending");}
  })));
  assert.equal(first.fenceConfirmed,true);
  assert.equal(first.cleanupComplete,false);
  assert.equal(serverCalls,1);

  const exactPending=JSON.parse(localStorage.getItem(CLEANUP_PENDING_KEY));
  assert.equal(exactPending.ownerId,"A");
  assert.equal(exactPending.lifecycleEpoch,1);
  assert.equal(exactPending.nextLifecycleEpoch,2);
  assert.equal(native.nativePushCleanupState({ownerId:"A"}).fenceConfirmed,true);

  // Same owner, different lifecycle transition cannot reuse the proof.
  localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify({
    ...exactPending,
    lifecycleEpoch:2,
    nextLifecycleEpoch:3,
    serverFenceWasConfirmedPreviously:true
  }));
  assert.equal(native.nativePushCleanupState({ownerId:"A"}).fenceConfirmed,false);

  // Same owner/epoch, different installation cannot reuse the proof.
  localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify({
    ...exactPending,
    installationId:"fix-pass-5-other-installation",
    serverFenceWasConfirmedPreviously:true
  }));
  assert.equal(native.nativePushCleanupState({ownerId:"A"}).fenceConfirmed,false);

  // Same owner/installation/previous epoch but wrong next epoch cannot reuse the proof.
  localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify({
    ...exactPending,
    nextLifecycleEpoch:3,
    serverFenceWasConfirmedPreviously:true
  }));
  assert.equal(native.nativePushCleanupState({ownerId:"A"}).fenceConfirmed,false);

  // Restore the exact pending tuple, switch to B, and prove B cannot consume A authority.
  localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify(exactPending));
  localStorage.setItem(EPOCH_KEY,"2");
  setAuth("B","auth-B");
  assert.equal(native.nativePushCleanupState().fenceConfirmed,false);

  // Even if a caller tries to label B's credential as owner A, A's proof is not reused.
  let forcedOwnerServerCalls=0;
  const forcedOwnerResult=await settlesWithin(native.disableNativePush("auth-B",options({
    ownerId:"A",
    serverUnsubscribe:async()=>{
      forcedOwnerServerCalls++;
      throw new Error("backend ownership conflict");
    },
    unregister:async()=>{}
  })));
  assert.equal(forcedOwnerServerCalls,1);
  assert.equal(forcedOwnerResult.cleanupComplete,false);
  assert.equal(forcedOwnerResult.fenceConfirmed,false);
  assert.notEqual(localStorage.getItem(CLEANUP_PENDING_KEY),null);

  // Normal B context cannot validate or revoke A's pending state either.
  let bServerCalls=0;
  const bResult=await settlesWithin(native.disableNativePush("auth-B",options({
    ownerId:"B",
    serverUnsubscribe:async()=>{bServerCalls++;return {lifecycleEpoch:2};},
    unregister:async()=>{}
  })));
  assert.equal(bServerCalls,0);
  assert.equal(bResult.cleanupComplete,false);
  assert.equal(bResult.fenceConfirmed,false);
  assert.notEqual(localStorage.getItem(CLEANUP_PENDING_KEY),null);

  // A can reuse the same in-memory proof only after returning to the exact owner/transition.
  setAuth("A","auth-A");
  assert.equal(native.nativePushCleanupState().fenceConfirmed,true);
  const aResult=await settlesWithin(native.disableNativePush("auth-A",options({
    ownerId:"A",
    serverUnsubscribe:async()=>{serverCalls++;throw new Error("must not revoke twice");},
    unregister:async()=>{}
  })));
  assert.equal(serverCalls,1);
  assert.equal(aResult.cleanupComplete,true);
  assert.equal(localStorage.getItem(CLEANUP_PENDING_KEY),null);
}

console.log("native push fix pass 5 behavioral tests passed");