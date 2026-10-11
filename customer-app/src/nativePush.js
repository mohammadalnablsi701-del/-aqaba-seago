import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerNativePushToken, unregisterNativePushToken } from "./api.js";
import { nativePushFeatureEnabled } from "./nativePushConfig.js";

const INSTALLATION_KEY="seago_native_installation_id";
const REGISTERED_KEY="seago_native_push_registered";
const OWNER_KEY="seago_native_push_owner_id";
const CLEANUP_PENDING_KEY="seago_native_push_cleanup_pending";
let listenerHandles=[];
let lifecycleGeneration=0;
const inFlightRegistrations=new Set();

function text(value){return String(value||"").trim();}
function currentInstallationId(){return text(localStorage.getItem(INSTALLATION_KEY));}
function currentOwnerId(){return text(localStorage.getItem(OWNER_KEY));}
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
    return {
      installationId:text(value.installationId),
      ownerId:text(value.ownerId),
      serverRevoked:value.serverRevoked===true,
      localUnregistered:value.localUnregistered===true
    };
  }catch{return null;}
}
function writeCleanupPending(state){
  localStorage.setItem(CLEANUP_PENDING_KEY,JSON.stringify({
    installationId:text(state?.installationId),
    ownerId:text(state?.ownerId),
    serverRevoked:state?.serverRevoked===true,
    localUnregistered:state?.localUnregistered===true
  }));
}
function clearCleanupForInstallation(id){
  const target=text(id);
  const pending=readCleanupPending();
  if(!pending||pending.installationId===target)localStorage.removeItem(CLEANUP_PENDING_KEY);
  if(currentInstallationId()===target){
    localStorage.removeItem(INSTALLATION_KEY);
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(REGISTERED_KEY);
  }
}
function cleanupComplete(state,{android=true}={}){
  return Boolean(state?.serverRevoked&&(android?state?.localUnregistered:true));
}

export function nativePushCleanupState(){
  const rawPending=localStorage.getItem(CLEANUP_PENDING_KEY);
  const pending=readCleanupPending();
  const installationId=pending?.installationId||currentInstallationId();
  const ownerId=pending?.ownerId||currentOwnerId();
  const registered=localStorage.getItem(REGISTERED_KEY)==="1";
  return {
    hadCredential:Boolean(rawPending||installationId||registered),
    cleanupPending:Boolean(rawPending),
    installationId,
    ownerId,
    serverRevoked:pending?.serverRevoked===true,
    localUnregistered:pending?.localUnregistered===true,
    registered
  };
}

function installationId(){
  let value=currentInstallationId();
  if(!value){
    value=(globalThis.crypto?.randomUUID?.()||`install-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,"_");
    localStorage.setItem(INSTALLATION_KEY,value);
  }
  return value;
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

function noteCompensatingServerRevoke(id,ownerId){
  const pending=readCleanupPending();
  if(!pending||pending.installationId!==id)return;
  writeCleanupPending({...pending,serverRevoked:true,ownerId:pending.ownerId||ownerId});
}

function noteCompensatingFailure(id,ownerId){
  const currentId=currentInstallationId();
  const pending=readCleanupPending();
  if(pending&&pending.installationId===id){
    writeCleanupPending({...pending,serverRevoked:false,ownerId:pending.ownerId||ownerId});
    return;
  }
  if(currentId&&currentId!==id)return;
  writeCleanupPending({
    installationId:id,
    ownerId,
    serverRevoked:false,
    localUnregistered:!currentId
  });
  if(!currentId){
    localStorage.setItem(INSTALLATION_KEY,id);
    if(ownerId)localStorage.setItem(OWNER_KEY,ownerId);
  }
}

async function registerToken(info,authToken,platform,id,generation,{
  serverSubscribe=registerNativePushToken,
  serverUnsubscribe=unregisterNativePushToken,
  ownerId="",
  logger=console
}={}){
  if(generation!==lifecycleGeneration)return;
  const token=text(info?.value);
  if(!token)return;
  await serverSubscribe({token,platform,installationId:id},authToken);
  if(generation!==lifecycleGeneration){
    const state=nativePushCleanupState();
    const activeSameLifecycleCredential=!state.cleanupPending&&currentInstallationId()===id&&(!ownerId||currentOwnerId()===ownerId);
    if(activeSameLifecycleCredential)return;
    try{
      await serverUnsubscribe(id,authToken);
      noteCompensatingServerRevoke(id,ownerId);
    }catch{
      noteCompensatingFailure(id,ownerId);
      safeWarn(logger,"Native push compensating revoke failed");
    }
    return;
  }
  localStorage.setItem(REGISTERED_KEY,"1");
}

export async function enableNativePush(authToken,{
  enabled=isNativePushEnabled(),
  pushNotifications=PushNotifications,
  serverSubscribe=registerNativePushToken,
  serverUnsubscribe=unregisterNativePushToken,
  platform=Capacitor.getPlatform(),
  ownerId=currentAuthOwnerId(),
  logger=console
}={}){
  if(!enabled)return {supported:false,permission:"disabled",subscribed:false,native:isNativeSeaGo()};
  if(!authToken)throw new Error("Authentication is required for push notifications");
  let permissions=await pushNotifications.checkPermissions();
  if(permissions.receive==="prompt")permissions=await pushNotifications.requestPermissions();
  if(permissions.receive!=="granted")throw new Error("Notification permission was not granted");
  const generation=++lifecycleGeneration;
  await clearListeners();
  const id=installationId();
  if(ownerId)localStorage.setItem(OWNER_KEY,text(ownerId));
  listenerHandles.push(await pushNotifications.addListener("registration",info=>{
    if(generation!==lifecycleGeneration)return;
    let task;
    task=registerToken(info,authToken,platform,id,generation,{serverSubscribe,serverUnsubscribe,ownerId:text(ownerId),logger})
      .catch(()=>{
        if(generation===lifecycleGeneration)localStorage.removeItem(REGISTERED_KEY);
      })
      .finally(()=>{inFlightRegistrations.delete(task);});
    inFlightRegistrations.add(task);
    void task;
  }));
  listenerHandles.push(await pushNotifications.addListener("registrationError",()=>{
    if(generation===lifecycleGeneration)localStorage.removeItem(REGISTERED_KEY);
  }));
  listenerHandles.push(await pushNotifications.addListener("pushNotificationActionPerformed",()=>{}));
  listenerHandles.push(await pushNotifications.addListener("pushNotificationReceived",()=>{}));
  await pushNotifications.register();
  return {supported:true,permission:"granted",subscribed:localStorage.getItem(REGISTERED_KEY)==="1",native:true};
}

export async function disableNativePush(authToken,{
  native=isNativeSeaGo(),
  android=isAndroidNativeSeaGo(),
  pushNotifications=PushNotifications,
  serverUnsubscribe=unregisterNativePushToken,
  ownerId=currentAuthOwnerId(),
  logger=console
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
  let pending={
    installationId:id,
    ownerId:pendingOwner,
    serverRevoked:state.cleanupPending?state.serverRevoked:false,
    localUnregistered:state.cleanupPending?state.localUnregistered:false
  };
  writeCleanupPending(pending);
  if(id&&!currentInstallationId())localStorage.setItem(INSTALLATION_KEY,id);
  if(pending.ownerId&&!currentOwnerId())localStorage.setItem(OWNER_KEY,pending.ownerId);

  const ownerMatches=!pending.ownerId||(callerOwner&&callerOwner===pending.ownerId);
  if(!pending.serverRevoked&&authToken&&id&&ownerMatches){
    try{
      await serverUnsubscribe(id,authToken);
      pending.serverRevoked=true;
      writeCleanupPending(pending);
    }catch{}
  }

  const currentId=currentInstallationId();
  const mayUnregisterLocally=android&&(!currentId||currentId===id);
  if(mayUnregisterLocally){
    try{
      await pushNotifications.unregister();
      pending.localUnregistered=true;
      localStorage.removeItem(REGISTERED_KEY);
      writeCleanupPending(pending);
    }catch{
      safeWarn(logger,"Native push local unregister failed");
    }
  }

  if(registrationsToSettle.length)await Promise.allSettled(registrationsToSettle);
  const settledPending=readCleanupPending();
  if(settledPending&&settledPending.installationId===id){
    pending={
      ...pending,
      ownerId:settledPending.ownerId||pending.ownerId,
      serverRevoked:pending.serverRevoked||settledPending.serverRevoked,
      localUnregistered:pending.localUnregistered||settledPending.localUnregistered
    };
  }

  const complete=cleanupComplete(pending,{android});
  if(complete)clearCleanupForInstallation(id);
  else writeCleanupPending(pending);
  await clearListeners();
  return {
    serverRevoked:pending.serverRevoked,
    localUnregistered:pending.localUnregistered,
    hadCredential:true,
    cleanupPending:!complete,
    cleanupComplete:complete,
    native:true
  };
}
