import { NATIVE_PUSH_CONTEXT } from "../../shared/nativePushContext.js";

const INSTALLATION_KEY="seago_native_installation_id";
const OPT_IN_KEY="seago_android_push_opt_in";
const LIFECYCLE_KEY="seago_native_push_lifecycle_generation";
const messages={
  disabled:"Native notifications are not available yet.",
  denied:"Notifications are blocked in your device settings for SeaGo.",
  timeout:"Notification registration timed out. Please try again.",
  registration:"Notification registration failed. Please try again.",
  sync:"Could not save notification settings. Please try again.",
  revoked:"Could not fully remove notification settings. Please reconnect and try again.",
  cancelled:"Notification registration was cancelled."
};

function tokenIdentity(token){
  const raw=String(token||"");
  try{
    const part=raw.split(".")[1];
    if(!part)return raw;
    const padded=part.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-part.length%4)%4);
    if(typeof globalThis.atob!=="function")return raw;
    const payload=JSON.parse(globalThis.atob(padded));
    return String(payload?.sub||payload?.userId||raw);
  }catch{return raw;}
}
function storedGeneration(storage){
  const value=Number(storage.getItem(LIFECYCLE_KEY)||0);
  return Number.isSafeInteger(value)&&value>=0?value:0;
}

export function createNativePushController({plugin,nativeBridge,storage,enabled,platform,api,notify=()=>{},onReceive=()=>{},onTap=()=>{},timeoutMs=15000,uuid=()=>crypto.randomUUID(),identityForToken=tokenIdentity}) {
  let auth="",accountIdentity="",epoch=storedGeneration(storage),handles=[],pendingCancel=null,queue=Promise.resolve(),nativeDeletionFailure=false;
  let state={supported:enabled && platform === "android",permission:"default",subscribed:false};
  const publish=patch=>{state={...state,...patch};notify({...state});return {...state};};
  const current=ctx=>Boolean(ctx)&&ctx.generation===epoch&&ctx.token===auth&&ctx.accountIdentity===accountIdentity;
  const problem=(code,ctx)=>{if(!ctx||current(ctx))publish({subscribed:false,message:messages[code]});return new Error(messages[code]);};
  const assertCurrent=ctx=>{if(!current(ctx))throw new Error(messages.cancelled);};
  function installationId(){
    let id=storage.getItem(INSTALLATION_KEY);
    if(!id || !/^[A-Za-z0-9_-]{16,128}$/.test(id)){id=uuid();storage.setItem(INSTALLATION_KEY,id);}
    return id;
  }
  function nextGeneration(){
    if(epoch>=Number.MAX_SAFE_INTEGER)throw problem("registration");
    epoch+=1;storage.setItem(LIFECYCLE_KEY,String(epoch));return epoch;
  }
  const serialize=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  async function clearListeners(){
    const old=handles;handles=[];
    await Promise.allSettled(old.map(h=>h.remove()));
  }
  function cancel(){
    const generation=nextGeneration();
    pendingCancel?.();pendingCancel=null;publish({subscribed:false});return generation;
  }
  const tapListenerReady=(async()=>{
    if(platform!=="android"||typeof plugin?.addListener!=="function")return;
    try{
      await plugin.addListener("pushNotificationActionPerformed",()=>onTap({authenticated:Boolean(auth),accountIdentity:accountIdentity||null}));
    }catch{}
  })();
  async function nativeConfigured(){
    if(platform!=="android"||!nativeBridge?.isConfigured)return false;
    try{
      const result=await nativeBridge.isConfigured();
      return result===true||result?.configured===true;
    }catch{return false;}
  }
  async function deleteNativeToken(){
    if(!(await nativeConfigured())){nativeDeletionFailure=false;return {skipped:true};}
    if(!nativeBridge?.deleteToken){nativeDeletionFailure=true;throw problem("revoked");}
    try{await nativeBridge.deleteToken();nativeDeletionFailure=false;return {deleted:true};}
    catch{nativeDeletionFailure=true;throw problem("revoked");}
  }
  async function revoke(token,generation,deleteDeviceToken=true){
    const tasks=[token?api.unregister(installationId(),token,generation):Promise.resolve()];
    if(deleteDeviceToken)tasks.push(deleteNativeToken());
    const results=await Promise.allSettled(tasks);
    if(results.some(r=>r.status==="rejected"))throw problem("revoked");
    return results;
  }
  async function registerToken(value,ctx){
    assertCurrent(ctx);
    if(nativeDeletionFailure)throw problem("revoked",ctx);
    if(typeof value!=="string" || value.length<16)throw problem("registration",ctx);
    assertCurrent(ctx);
    try { await api.register({...NATIVE_PUSH_CONTEXT,token:value,installationId:installationId(),lifecycleGeneration:ctx.generation},ctx.token,ctx.generation); }
    catch { throw problem("sync",ctx); }
    assertCurrent(ctx);
    publish({subscribed:true,message:""});
  }
  async function start(ctx,prompt){
    assertCurrent(ctx);
    if(!state.supported || !ctx.token)throw problem("disabled",ctx);
    if(nativeDeletionFailure)throw problem("revoked",ctx);
    const configured=await nativeConfigured();
    assertCurrent(ctx);
    if(!configured)throw problem("disabled",ctx);
    let backend;
    try { backend=await api.status(ctx.token); } catch { throw problem("sync",ctx); }
    assertCurrent(ctx);
    if(!backend.enabled)throw problem("disabled",ctx);
    let permission=await plugin.checkPermissions();
    assertCurrent(ctx);
    if(prompt && ["prompt","prompt-with-rationale"].includes(permission.receive)){
      permission=await plugin.requestPermissions();
      assertCurrent(ctx);
    }
    publish({permission:permission.receive,...(permission.receive!=="granted"?{subscribed:false}:{})});
    if(permission.receive!=="granted"){
      if(prompt)throw problem("denied",ctx);
      return state;
    }
    await clearListeners();
    assertCurrent(ctx);
    await plugin.createChannel({id:"seago_updates",name:"SeaGo trip updates",importance:3,visibility:0});
    assertCurrent(ctx);
    let resolveFirst,rejectFirst,first=true,timer;
    const registered=new Promise((resolve,reject)=>{resolveFirst=resolve;rejectFirst=reject;});
    registered.catch(()=>{});
    pendingCancel=()=>rejectFirst(new Error(messages.cancelled));
    try{
      handles.push(await plugin.addListener("registration",value=>{
        if(!current(ctx))return;
        if(first){first=false;resolveFirst(value?.value);}
        else void serialize(()=>registerToken(value?.value,ctx)).catch(()=>{});
      }));
      assertCurrent(ctx);
      handles.push(await plugin.addListener("registrationError",()=>{
        if(!current(ctx))return;
        if(first)rejectFirst(problem("registration",ctx));else problem("registration",ctx);
      }));
      assertCurrent(ctx);
      handles.push(await plugin.addListener("pushNotificationReceived",()=>{if(current(ctx))onReceive();}));
      assertCurrent(ctx);
      timer=setTimeout(()=>rejectFirst(problem("timeout",ctx)),timeoutMs);
      assertCurrent(ctx);
      void plugin.register().catch(()=>rejectFirst(problem("registration",ctx)));
      const value=await registered;
      assertCurrent(ctx);
      await registerToken(value,ctx);
      assertCurrent(ctx);
      storage.setItem(OPT_IN_KEY,"true");
      return state;
    }catch(error){
      await clearListeners();
      throw error;
    }finally{clearTimeout(timer);if(pendingCancel)pendingCancel=null;}
  }
  function setAuth(token=""){
    token=String(token||"");
    const nextIdentity=token?String(identityForToken(token)||token):"";
    if(token===auth && nextIdentity===accountIdentity)return queue.then(()=>({...state}));
    const previous=auth;
    auth=token;accountIdentity=nextIdentity;
    const generation=cancel();
    const ctx={token,accountIdentity:nextIdentity,generation};
    return serialize(async()=>{
      await tapListenerReady;
      await clearListeners();
      if(platform!=="android")return state;
      if(previous)await revoke(previous,generation,!token);
      if(!current(ctx))return state;
      if(!state.supported){
        if(token && storage.getItem(OPT_IN_KEY)==="true"){
          storage.removeItem(OPT_IN_KEY);
          await revoke(token,generation,true);
        }
        return state;
      }
      if(token && storage.getItem(OPT_IN_KEY)==="true")return start(ctx,false);
      return state;
    });
  }
  function enable(token){
    token=String(token||"");
    const ready=setAuth(token);
    const ctx={token,accountIdentity:token?String(identityForToken(token)||token):"",generation:epoch};
    return ready.then(()=>serialize(()=>start(ctx,true))).catch(error=>{
      if(error?.message===messages.cancelled)throw error;
      if(Object.values(messages).includes(error?.message))throw error;
      if(current(ctx))throw problem("registration",ctx);
      throw new Error(messages.cancelled);
    });
  }
  function disable(token=auth){
    const revokeToken=String(token||auth||"");
    auth="";accountIdentity="";
    const generation=cancel();
    storage.removeItem(OPT_IN_KEY);
    return serialize(async()=>{
      await tapListenerReady;
      await clearListeners();
      if(platform==="android")await revoke(revokeToken,generation,true);
      return state;
    });
  }
  function resume(){
    const ctx={token:auth,accountIdentity,generation:epoch};
    if(!ctx.token || !state.supported || storage.getItem(OPT_IN_KEY)!=="true")return Promise.resolve(state);
    return serialize(()=>current(ctx)?start(ctx,false):state);
  }
  return {setAuth,enable,disable,resume,status:()=>({...state}),installationId};
}
