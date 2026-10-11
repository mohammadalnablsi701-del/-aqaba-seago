import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { expireAuthenticatedSession } from "./api.js";
import { registerNativePushToken, unregisterNativePushToken } from "./nativePushTransport.js";
import { nativePushFeatureEnabled } from "./nativePushConfig.js";
import { withTimeout } from "./boundedAsync.js";

const INSTALLATION_KEY="seago_native_installation_id";
const EPOCH_KEY="seago_native_push_lifecycle_epoch";
const REGISTERED_KEY="seago_native_push_registered";
const OWNER_KEY="seago_native_push_owner_id";
const CLEANUP_PENDING_KEY="seago_native_push_cleanup_pending";
const DEFAULT_SETTLEMENT_TIMEOUT_MS=1000;
const DEFAULT_REVOKE_TIMEOUT_MS=5000;
const DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS=5000;
let listenerHandles=[];
let lifecycleGeneration=0;
const inFlightRegistrations=new Set();
const inMemoryFenceConfirmations=new Map();

function text(value){return String(value||"").trim();}
function validEpoch(value){const epoch=Number(value);return Number.isSafeInteger(epoch)&&epoch>=1?epoch:0;}
function currentInstallationId(){return text(localStorage.getItem(INSTALLATION_KEY));}
function currentOwnerId(){return text(localStorage.getItem(OWNER_KEY));}
function currentLifecycleEpoch(){return validEpoch(localStorage.getItem(EPOCH_KEY));}
function currentAuthOwnerId(){
  try{
    const auth=JSON.parse(localStorage.getItem("seago_auth")||"null");
    return text(auth?.user?.id||auth?.user?._id);
  }catch{return "";}
}
function fenceAuthorityKey(state,nextLifecycleEpoch=state?.nextLifecycleEpoch){
  const installationId=text(state?.installationId);
  const ownerId=text(state?.ownerId);
  const previousEpoch=validEpoch(state?.lifecycleEpoch);
  const confirmedNextEpoch=validEpoch(nextLifecycleEpoch);
  if(!installationId||!ownerId||!previousEpoch||confirmedNextEpoch!==previousEpoch+1)return "";
  return `${installationId}\u0000${ownerId}\u0000${previousEpoch}\u0000${confirmedNextEpoch}`;
}
function rememberFenceConfirmation(state,nextLifecycleEpoch){
  const key=fenceAuthorityKey(state,nextLifecycleEpoch);
  if(!key)return false;
  inMemoryFenceConfirmations.set(key,{
    installationId:text(state?.installationId),
    ownerId:text(state?.ownerId),
    previousEpoch:validEpoch(state?.lifecycleEpoch),
    confirmedNextEpoch:validEpoch(nextLifecycleEpoch)
  });
  return true;
}
function applyInMemoryFenceAuthority(state,{ownerId=currentAuthOwnerId()}={}){
  if(!state)return state;
  if(state.serverFenceWasConfirmedPreviously!==true){
    return {...state,fenceConfirmed:false,serverRevoked:false};
  }
  const expectedOwner=text(ownerId);
  const stateOwner=text(state?.ownerId);
  if(!expectedOwner||!stateOwner||expectedOwner!==stateOwner){
    return {...state,fenceConfirmed:false,serverRevoked:false};
  }
  const key=fenceAuthorityKey(state,state?.nextLifecycleEpoch);
  const authority=key?inMemoryFenceConfirmations.get(key):null;
  if(!authority||
    authority.installationId!==text(state?.installationId)||
    authority.ownerId!==stateOwner||
    authority.previousEpoch!==validEpoch(state?.lifecycleEpoch)||
    authority.confirmedNextEpoch!==validEpoch(state?.nextLifecycleEpoch)){
    return {...state,fenceConfirmed:false,serverRevoked:false};
  }
  return {
    ...state,
    fenceConfirmed:true,
    serverRevoked:true,
    serverFenceWasConfirmedPreviously:true,
    nextLifecycleEpoch:authority.confirmedNextEpoch
  };
}
function forgetFenceConfirmations(installationId){
  const prefix=`${text(installationId)}\u0000`;
  for(const key of inMemoryFenceConfirmations.keys()){
    if(key.startsWith(prefix))inMemoryFenceConfirmations.delete(key);
  }
}
function readCleanupPending(){
  const raw=localStorage.getItem(CLEANUP_PENDING_KEY);
  if(!raw)return null;
  try{
    const value=JSON.parse(raw);
    if(!value||typeof value!=="object")return null;
    const lifecycleEpoch=validEpoch(value.lifecycleEpoch)||currentLifecycleEpoch()||1;
    const nextLifecycleEpoch=validEpoch(value.nextLifecycleEpoch);
    const serverFenceWasConfirmedPreviously=
      value.serverFenceWasConfirmedPreviously===true||
      value.fenceConfirmed===true||
      value.serverRevoked===true;
    return {
      installationId:text(value.installationId),
      ownerId:text(value.ownerId),
      lifecycleEpoch,
      nextLifecycleEpoch,
      serverFenceWasConfirmedPreviously,
      // Persistent storage is a recovery hint only. Authority is restored only
      // by applyInMemoryFenceAuthority after a fresh response in this lifecycle.
      fenceConfirmed:false,
      serverRevoked:false,
      localUnregistered:value.localUnregistered===true
    };
  }catch{return null;}
}
function writeCleanupPending(state){
  localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify({
    installationId:text(state?.installationId),
    ownerId:text(state?.ownerId),
    lifecycleEpoch:validEpoch(state?.lifecycleEpoch)||1,
    nextLifecycleEpoch:validEpoch(state?.nextLifecycleEpoch)||0,
    serverFenceWasConfirmedPreviously:
      state?.serverFenceWasConfirmedPreviously===true||
      state?.fenceConfirmed===true||
      state?.serverRevoked===true,
    // Retained only for backward-compatible recovery diagnostics. readCleanupPending
    // never restores these booleans as current-lifecycle authority.
    fenceConfirmed:state?.fenceConfirmed===true,
    serverRevoked:state?.fenceConfirmed===true&&state?.serverRevoked===true,
    localUnregistered:state?.localUnregistered===true
  }));
}
function clearCleanupForInstallation(id){
  const target=text(id);
  const pending=readCleanupPending();
  if(!pending||pending.installationId===target)localStorage.removeItem(CLEANUP_PENDING_KEY);
  forgetFenceConfirmations(target);
  if(currentInstallationId()===target){
    localStorage.removeItem(INSTALLATION_KEY);
    localStorage.removeItem(EPOCH_KEY);
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(REGISTERED_KEY);
  }
}
function cleanupComplete(state,{android=true}={}){
  return Boolean(text(state?.ownerId)&&state?.serverRevoked&&state?.fenceConfirmed&&(android?state?.localUnregistered:true));
}

export function nativePushCleanupState({ownerId=currentAuthOwnerId()}={}){
  const rawPending=localStorage.getItem(CLEANUP_PENDING_KEY);
  const persisted=readCleanupPending();
  const pending=applyInMemoryFenceAuthority(persisted,{ownerId});
  const installationId=pending?.installationId||currentInstallationId();
  const resolvedOwnerId=persisted?text(persisted.ownerId):currentOwnerId();
  const lifecycleEpoch=pending?.lifecycleEpoch||currentLifecycleEpoch();
  const registered=localStorage.getItem(REGISTERED_KEY)==="1";
  return {
    hadCredential:Boolean(rawPending||installationId||registered),
    cleanupPending:Boolean(rawPending),
    installationId,
    ownerId:resolvedOwnerId,
    lifecycleEpoch,
    nextLifecycleEpoch:pending?.nextLifecycleEpoch||0,
    serverFenceWasConfirmedPreviously:pending?.serverFenceWasConfirmedPreviously===true,
    fenceConfirmed:pending?.fenceConfirmed===true,
    serverRevoked:pending?.serverRevoked===true,
    localUnregistered:pending?.localUnregistered===true,
    registered
  };
}

function installationState(){
  let installationId=currentInstallationId();
  let lifecycleEpoch=currentLifecycleEpoch();
  if(!installationId){
    installationId=(globalThis.crypto?.randomUUID?.()||`install-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,"_");
    lifecycleEpoch=1;
    localStorage.setItem(INSTALLATION_KEY,installationId);
    localStorage.setItem(EPOCH_KEY,"1");
  }else if(!lifecycleEpoch){
    lifecycleEpoch=1;
    localStorage.setItem(EPOCH_KEY,"1");
  }
  return {installationId,lifecycleEpoch};
}

export function isNativeSeaGo(){return Capacitor.isNativePlatform();}
export function isAndroidNativeSeaGo(){return isNativeSeaGo()&&Capacitor.getPlatform()==="android";}
export function isNativePushEnabled(){return nativePushFeatureEnabled()&&isAndroidNativeSeaGo();}

export async function nativePushPermission(){
  if(!isNativePushEnabled())return {supported:false,permission:"disabled",subscribed:false,native:isNativeSeaGo()};
  const status=await PushNotifications.checkPermissions();
  return {supported:true,permission:status.receive,subscribed:localStorage.getItem(REGISTERED_KEY)==="1"&&!nativePushCleanupState().cleanupPending,native:true};
}

function safeWarn(logger,message){
  try{logger?.warn?.(message);}catch{}
}

async function clearListeners({timeoutMs=DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS,logger=console}={}){
  const handles=listenerHandles;
  listenerHandles=[];
  await Promise.allSettled(handles.map(async handle=>{
    if(typeof handle?.remove!=="function")return;
    try{
      await withTimeout(
        ()=>handle.remove(),
        timeoutMs,
        {
          defaultTimeoutMs:DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS,
          code:"NATIVE_PUSH_LISTENER_CLEANUP_TIMEOUT",
          message:"Native push listener cleanup timed out"
        }
      );
    }catch(error){
      safeWarn(
        logger,
        error?.code==="NATIVE_PUSH_LISTENER_CLEANUP_TIMEOUT"
          ?"Native push listener cleanup timed out"
          :"Native push listener cleanup failed"
      );
    }
  }));
}

async function settleBounded(tasks,timeoutMs){
  if(!tasks.length)return;
  const duration=Number.isFinite(Number(timeoutMs))&&Number(timeoutMs)>=0?Number(timeoutMs):DEFAULT_SETTLEMENT_TIMEOUT_MS;
  if(duration===0)return;
  let timer;
  try{
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise(resolve=>{timer=setTimeout(resolve,duration);})
    ]);
  }finally{
    if(timer)clearTimeout(timer);
  }
}

async function callBounded(factory,timeoutMs){
  return withTimeout(factory,timeoutMs,{
    defaultTimeoutMs:DEFAULT_REVOKE_TIMEOUT_MS,
    code:"NATIVE_PUSH_LIFECYCLE_TIMEOUT",
    message:"Native push lifecycle operation timed out"
  });
}

function confirmedNextEpoch(response,revokeEpoch){
  const next=validEpoch(response?.lifecycleEpoch);
  if(next!==revokeEpoch+1)throw new Error("Invalid native push lifecycle fence response");
  return next;
}

async function registerToken(info,authToken,platform,id,lifecycleEpoch,generation,{
  serverSubscribe=registerNativePushToken
}={}){
  if(generation!==lifecycleGeneration)return;
  const token=text(info?.value);
  if(!token)return;
  const response=await serverSubscribe({token,platform,installationId:id,lifecycleEpoch},authToken);
  if(validEpoch(response?.lifecycleEpoch)!==lifecycleEpoch)throw new Error("Invalid native push lifecycle subscribe response");
  if(generation!==lifecycleGeneration)return;
  localStorage.setItem(REGISTERED_KEY,"1");
}

export async function enableNativePush(authToken,{
  enabled=isNativePushEnabled(),
  pushNotifications=PushNotifications,
  serverSubscribe=registerNativePushToken,
  platform=Capacitor.getPlatform(),
  ownerId=currentAuthOwnerId(),
  sessionExpiry=expireAuthenticatedSession,
  logger=console,
  listenerCleanupTimeoutMs=DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS
}={}){
  if(!enabled)return {supported:false,permission:"disabled",subscribed:false,native:isNativeSeaGo()};
  if(!authToken)throw new Error("Authentication is required for push notifications");
  const prior=nativePushCleanupState();
  if(prior.cleanupPending)throw new Error("Native notification credential cleanup is pending");
  const normalizedOwner=text(ownerId);
  if(currentOwnerId()&&normalizedOwner&&currentOwnerId()!==normalizedOwner)throw new Error("Native notification installation ownership conflict");

  let permissions=await pushNotifications.checkPermissions();
  if(permissions.receive==="prompt")permissions=await pushNotifications.requestPermissions();
  if(permissions.receive!=="granted")throw new Error("Notification permission was not granted");
  const generation=++lifecycleGeneration;
  await clearListeners({timeoutMs:listenerCleanupTimeoutMs,logger});
  const {installationId:id,lifecycleEpoch}=installationState();
  if(normalizedOwner)localStorage.setItem(OWNER_KEY,normalizedOwner);
  listenerHandles.push(await pushNotifications.addListener("registration",info=>{
    if(generation!==lifecycleGeneration)return;
    let unauthorized=false;
    let task;
    task=registerToken(info,authToken,platform,id,lifecycleEpoch,generation,{serverSubscribe})
      .catch(error=>{
        unauthorized=error?.status===401;
        if(generation===lifecycleGeneration)localStorage.removeItem(REGISTERED_KEY);
      })
      .finally(()=>{
        inFlightRegistrations.delete(task);
        if(unauthorized){
          void Promise.resolve().then(()=>sessionExpiry({logger})).catch(()=>{});
        }
      });
    inFlightRegistrations.add(task);
    void task;
  }));
  listenerHandles.push(await pushNotifications.addListener("registrationError",()=>{
    if(generation===lifecycleGeneration)localStorage.removeItem(REGISTERED_KEY);
  }));
  listenerHandles.push(await pushNotifications.addListener("pushNotificationActionPerformed",()=>{}));
  listenerHandles.push(await pushNotifications.addListener("pushNotificationReceived",()=>{}));
  await pushNotifications.register();
  return {supported:true,permission:"granted",subscribed:localStorage.getItem(REGISTERED_KEY)==="1",native:true,lifecycleEpoch};
}

export async function disableNativePush(authToken,{
  native=isNativeSeaGo(),
  android=isAndroidNativeSeaGo(),
  pushNotifications=PushNotifications,
  serverUnsubscribe=unregisterNativePushToken,
  ownerId=currentAuthOwnerId(),
  logger=console,
  settlementTimeoutMs=DEFAULT_SETTLEMENT_TIMEOUT_MS,
  revokeTimeoutMs=DEFAULT_REVOKE_TIMEOUT_MS,
  unregisterTimeoutMs=DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS,
  listenerCleanupTimeoutMs=DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS
}={}){
  if(!native)return {serverRevoked:false,localUnregistered:false,hadCredential:false,cleanupPending:false,cleanupComplete:true,native:false};

  ++lifecycleGeneration;
  const registrationsToSettle=[...inFlightRegistrations];
  const callerOwner=text(ownerId)||currentAuthOwnerId();
  const state=nativePushCleanupState({ownerId:callerOwner});
  if(!state.hadCredential){
    await clearListeners({timeoutMs:listenerCleanupTimeoutMs,logger});
    return {serverRevoked:false,localUnregistered:false,hadCredential:false,cleanupPending:false,cleanupComplete:true,native:true};
  }

  const id=state.installationId;
  const pendingOwner=state.ownerId;
  const existingPending=applyInMemoryFenceAuthority(readCleanupPending(),{ownerId:callerOwner});
  let pending=existingPending||{
    installationId:id,
    ownerId:pendingOwner,
    lifecycleEpoch:state.lifecycleEpoch||currentLifecycleEpoch()||1,
    nextLifecycleEpoch:0,
    serverFenceWasConfirmedPreviously:false,
    fenceConfirmed:false,
    serverRevoked:false,
    localUnregistered:false
  };
  pending={...pending,ownerId:pending.ownerId||pendingOwner};
  writeCleanupPending(pending);
  if(id&&!currentInstallationId())localStorage.setItem(INSTALLATION_KEY,id);
  if(pending.lifecycleEpoch&&!currentLifecycleEpoch())localStorage.setItem(EPOCH_KEY,String(pending.lifecycleEpoch));
  if(pending.ownerId&&!currentOwnerId())localStorage.setItem(OWNER_KEY,pending.ownerId);

  const ownerMatches=Boolean(pending.ownerId&&callerOwner&&callerOwner===pending.ownerId);
  if(!pending.fenceConfirmed&&authToken&&id&&ownerMatches){
    try{
      const response=await callBounded(
        ()=>serverUnsubscribe({installationId:id,lifecycleEpoch:pending.lifecycleEpoch},authToken),
        revokeTimeoutMs
      );
      const nextLifecycleEpoch=confirmedNextEpoch(response,pending.lifecycleEpoch);
      if(!rememberFenceConfirmation(pending,nextLifecycleEpoch))throw new Error("Invalid native push fence authority");
      pending={
        ...pending,
        serverFenceWasConfirmedPreviously:true,
        serverRevoked:true,
        fenceConfirmed:true,
        nextLifecycleEpoch
      };
      localStorage.setItem(EPOCH_KEY,String(nextLifecycleEpoch));
      writeCleanupPending(pending);
    }catch{}
  }

  const currentId=currentInstallationId();
  const mayUnregisterLocally=android&&(!currentId||currentId===id);
  if(mayUnregisterLocally&&!pending.localUnregistered){
    try{
      await withTimeout(
        ()=>pushNotifications.unregister(),
        unregisterTimeoutMs,
        {
          defaultTimeoutMs:DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS,
          code:"NATIVE_PUSH_LOCAL_UNREGISTER_TIMEOUT",
          message:"Native push local unregister timed out"
        }
      );
      pending={...pending,localUnregistered:true};
      localStorage.removeItem(REGISTERED_KEY);
      writeCleanupPending(pending);
    }catch(error){
      safeWarn(
        logger,
        error?.code==="NATIVE_PUSH_LOCAL_UNREGISTER_TIMEOUT"
          ?"Native push local unregister timed out"
          :"Native push local unregister failed"
      );
    }
  }

  await settleBounded(registrationsToSettle,settlementTimeoutMs);

  const complete=cleanupComplete(pending,{android});
  if(complete)clearCleanupForInstallation(id);
  else writeCleanupPending(pending);
  await clearListeners({timeoutMs:listenerCleanupTimeoutMs,logger});
  return {
    serverRevoked:pending.serverRevoked,
    fenceConfirmed:pending.fenceConfirmed,
    localUnregistered:pending.localUnregistered,
    lifecycleEpoch:pending.lifecycleEpoch,
    nextLifecycleEpoch:pending.nextLifecycleEpoch,
    hadCredential:true,
    cleanupPending:!complete,
    cleanupComplete:complete,
    native:true
  };
}

export const nativePushLifecycleInternals={
  readCleanupPending,
  validEpoch,
  fenceAuthorityKey,
  settleBounded,
  callBounded,
  clearListeners,
  applyInMemoryFenceAuthority,
  DEFAULT_NATIVE_CLEANUP_TIMEOUT_MS
};
