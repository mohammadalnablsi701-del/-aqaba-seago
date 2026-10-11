import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { expireAuthenticatedSession } from "./api.js";
import { registerNativePushToken, unregisterNativePushToken } from "./nativePushTransport.js";
import { nativePushFeatureEnabled } from "./nativePushConfig.js";

const INSTALLATION_KEY="seago_native_installation_id";
const EPOCH_KEY="seago_native_push_lifecycle_epoch";
const REGISTERED_KEY="seago_native_push_registered";
const OWNER_KEY="seago_native_push_owner_id";
const CLEANUP_PENDING_KEY="seago_native_push_cleanup_pending";
const DEFAULT_SETTLEMENT_TIMEOUT_MS=1000;
const DEFAULT_REVOKE_TIMEOUT_MS=5000;
let listenerHandles=[];
let lifecycleGeneration=0;
const inFlightRegistrations=new Set();

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
function readCleanupPending(){
  const raw=localStorage.getItem(CLEANUP_PENDING_KEY);
  if(!raw)return null;
  try{
    const value=JSON.parse(raw);
    if(!value||typeof value!=="object")return null;
    const lifecycleEpoch=validEpoch(value.lifecycleEpoch)||currentLifecycleEpoch()||1;
    const nextLifecycleEpoch=validEpoch(value.nextLifecycleEpoch);
    const fenceConfirmed=value.fenceConfirmed===true;
    return {
      installationId:text(value.installationId),
      ownerId:text(value.ownerId),
      lifecycleEpoch,
      nextLifecycleEpoch,
      fenceConfirmed,
      serverRevoked:fenceConfirmed&&value.serverRevoked===true,
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
    fenceConfirmed:state?.fenceConfirmed===true,
    serverRevoked:state?.fenceConfirmed===true&&state?.serverRevoked===true,
    localUnregistered:state?.localUnregistered===true
  }));
}
function clearCleanupForInstallation(id){
  const target=text(id);
  const pending=readCleanupPending();
  if(!pending||pending.installationId===target)localStorage.removeItem(CLEANUP_PENDING_KEY);
  if(currentInstallationId()===target){
    localStorage.removeItem(INSTALLATION_KEY);
    localStorage.removeItem(EPOCH_KEY);
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(REGISTERED_KEY);
  }
}
function cleanupComplete(state,{android=true}={}){
  return Boolean(state?.serverRevoked&&state?.fenceConfirmed&&(android?state?.localUnregistered:true));
}

export function nativePushCleanupState(){
  const rawPending=localStorage.getItem(CLEANUP_PENDING_KEY);
  const pending=readCleanupPending();
  const installationId=pending?.installationId||currentInstallationId();
  const ownerId=pending?.ownerId||currentOwnerId();
  const lifecycleEpoch=pending?.lifecycleEpoch||currentLifecycleEpoch();
  const registered=localStorage.getItem(REGISTERED_KEY)==="1";
  return {
    hadCredential:Boolean(rawPending||installationId||registered),
    cleanupPending:Boolean(rawPending),
    installationId,
    ownerId,
    lifecycleEpoch,
    nextLifecycleEpoch:pending?.nextLifecycleEpoch||0,
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

async function clearListeners(){
  await Promise.allSettled(listenerHandles.map(handle=>handle.remove()));
  listenerHandles=[];
}

function safeWarn(logger,message){
  try{logger?.warn?.(message);}catch{}
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
  const duration=Number.isFinite(Number(timeoutMs))&&Number(timeoutMs)>0?Number(timeoutMs):DEFAULT_REVOKE_TIMEOUT_MS;
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          const error=new Error("Native push lifecycle operation timed out");
          error.code="NATIVE_PUSH_LIFECYCLE_TIMEOUT";
          reject(error);
        },duration);
      })
    ]);
  }finally{
    if(timer)clearTimeout(timer);
  }
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
  logger=console
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
  await clearListeners();
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
  revokeTimeoutMs=DEFAULT_REVOKE_TIMEOUT_MS
}={}){
  if(!native)return {serverRevoked:false,localUnregistered:false,hadCredential:false,cleanupPending:false,cleanupComplete:true,native:false};

  ++lifecycleGeneration;
  const registrationsToSettle=[...inFlightRegistrations];
  const state=nativePushCleanupState();
  if(!state.hadCredential){
    await clearListeners();
    return {serverRevoked:false,localUnregistered:false,hadCredential:false,cleanupPending:false,cleanupComplete:true,native:true};
  }

  const id=state.installationId;
  const callerOwner=text(ownerId)||currentAuthOwnerId();
  const pendingOwner=state.ownerId||(state.cleanupPending?"":callerOwner);
  const existingPending=readCleanupPending();
  let pending=existingPending||{
    installationId:id,
    ownerId:pendingOwner,
    lifecycleEpoch:state.lifecycleEpoch||currentLifecycleEpoch()||1,
    nextLifecycleEpoch:0,
    fenceConfirmed:false,
    serverRevoked:false,
    localUnregistered:false
  };
  pending={...pending,ownerId:pending.ownerId||pendingOwner};
  writeCleanupPending(pending);
  if(id&&!currentInstallationId())localStorage.setItem(INSTALLATION_KEY,id);
  if(pending.lifecycleEpoch&&!currentLifecycleEpoch())localStorage.setItem(EPOCH_KEY,String(pending.lifecycleEpoch));
  if(pending.ownerId&&!currentOwnerId())localStorage.setItem(OWNER_KEY,pending.ownerId);

  const ownerMatches=!pending.ownerId||(callerOwner&&callerOwner===pending.ownerId);
  if(!pending.serverRevoked&&authToken&&id&&ownerMatches){
    try{
      const response=await callBounded(
        ()=>serverUnsubscribe({installationId:id,lifecycleEpoch:pending.lifecycleEpoch},authToken),
        revokeTimeoutMs
      );
      const nextLifecycleEpoch=confirmedNextEpoch(response,pending.lifecycleEpoch);
      pending={...pending,serverRevoked:true,fenceConfirmed:true,nextLifecycleEpoch};
      localStorage.setItem(EPOCH_KEY,String(nextLifecycleEpoch));
      writeCleanupPending(pending);
    }catch{}
  }

  const currentId=currentInstallationId();
  const mayUnregisterLocally=android&&(!currentId||currentId===id);
  if(mayUnregisterLocally&&!pending.localUnregistered){
    try{
      await pushNotifications.unregister();
      pending={...pending,localUnregistered:true};
      localStorage.removeItem(REGISTERED_KEY);
      writeCleanupPending(pending);
    }catch{
      safeWarn(logger,"Native push local unregister failed");
    }
  }

  await settleBounded(registrationsToSettle,settlementTimeoutMs);

  const complete=cleanupComplete(pending,{android});
  if(complete)clearCleanupForInstallation(id);
  else writeCleanupPending(pending);
  await clearListeners();
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
  settleBounded,
  callBounded
};
