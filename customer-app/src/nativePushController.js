import { NATIVE_PUSH_CONTEXT } from "../../shared/nativePushContext.js";

const INSTALLATION_KEY="seago_native_installation_id";
const OPT_IN_KEY="seago_android_push_opt_in";
const messages={
  disabled:"Native notifications are not available yet.",
  denied:"Notifications are blocked in your device settings for SeaGo.",
  timeout:"Notification registration timed out. Please try again.",
  registration:"Notification registration failed. Please try again.",
  sync:"Could not save notification settings. Please try again.",
  revoked:"Could not fully remove notification settings. Please reconnect and try again.",
  cancelled:"Notification registration was cancelled."
};

export function createNativePushController({plugin,storage,enabled,platform,api,notify=()=>{},onReceive=()=>{},onTap=()=>{},timeoutMs=15000,uuid=()=>crypto.randomUUID()}) {
  let auth="",epoch=0,handles=[],pendingCancel=null,queue=Promise.resolve();
  let state={supported:enabled && platform === "android",permission:"default",subscribed:false};
  const publish=patch=>{state={...state,...patch};notify({...state});return {...state};};
  const problem=code=>{publish({subscribed:false,message:messages[code]});return new Error(messages[code]);};
  function installationId(){
    let id=storage.getItem(INSTALLATION_KEY);
    if(!id || !/^[A-Za-z0-9_-]{16,128}$/.test(id)){id=uuid();storage.setItem(INSTALLATION_KEY,id);}
    return id;
  }
  const serialize=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  async function clearListeners(){
    const old=handles;handles=[];
    await Promise.all(old.map(h=>h.remove()));
  }
  function cancel(){epoch++;pendingCancel?.();pendingCancel=null;publish({subscribed:false});return epoch;}
  async function revoke(token,unregisterDevice=true){
    const results=await Promise.allSettled([token?api.unregister(installationId(),token):Promise.resolve(),unregisterDevice?plugin.unregister():Promise.resolve()]);
    if(results.some(r=>r.status==="rejected")) throw problem("revoked");
  }
  async function registerToken(value,token,generation){
    if(generation!==epoch || token!==auth)return;
    if(typeof value!=="string" || value.length<16)throw problem("registration");
    try { await api.register({...NATIVE_PUSH_CONTEXT,token:value,installationId:installationId()},token); }
    catch { throw problem("sync"); }
    if(generation===epoch && token===auth) publish({subscribed:true,message:""});
  }
  async function start(token,generation,prompt){
    if(!state.supported || !token)throw problem("disabled");
    let backend;
    try { backend=await api.status(token); } catch { throw problem("sync"); }
    if(generation!==epoch)return state;
    if(!backend.enabled)throw problem("disabled");
    let permission=await plugin.checkPermissions();
    if(prompt && ["prompt","prompt-with-rationale"].includes(permission.receive))permission=await plugin.requestPermissions();
    if(generation!==epoch)return state;
    publish({permission:permission.receive,...(permission.receive!=="granted"?{subscribed:false}:{})});
    if(permission.receive!=="granted"){
      if(prompt)throw problem("denied");
      return state;
    }
    await clearListeners();
    await plugin.createChannel({id:"seago_updates",name:"SeaGo trip updates",importance:3,visibility:0});
    let resolveFirst,rejectFirst,first=true,timer;
    const registered=new Promise((resolve,reject)=>{resolveFirst=resolve;rejectFirst=reject;});
    registered.catch(()=>{});
    pendingCancel=()=>rejectFirst(new Error(messages.cancelled));
    try{
      handles.push(await plugin.addListener("registration",value=>{
        if(generation!==epoch)return;
        if(first){first=false;resolveFirst(value?.value);}
        else void serialize(()=>registerToken(value?.value,token,generation)).catch(()=>{});
      }));
      handles.push(await plugin.addListener("registrationError",()=>{
        if(generation!==epoch)return;
        if(first)rejectFirst(problem("registration"));else problem("registration");
      }));
      handles.push(await plugin.addListener("pushNotificationReceived",()=>{if(generation===epoch && auth)onReceive();}));
      handles.push(await plugin.addListener("pushNotificationActionPerformed",()=>{if(generation===epoch && auth)onTap();}));
      if(generation!==epoch)throw new Error(messages.cancelled);
      timer=setTimeout(()=>rejectFirst(problem("timeout")),timeoutMs);
      void plugin.register().catch(()=>rejectFirst(problem("registration")));
      const value=await registered;
      await registerToken(value,token,generation);
      if(generation===epoch)storage.setItem(OPT_IN_KEY,"true");
      return state;
    }catch(error){
      await clearListeners();
      throw error;
    }finally{clearTimeout(timer);pendingCancel=null;}
  }
  function setAuth(token=""){
    token=String(token||"");
    if(token===auth)return queue.then(()=>({...state}));
    const previous=auth;auth=token;
    const generation=cancel();
    return serialize(async()=>{
      await clearListeners();
      if(platform!=="android")return state;
      // Rebind after server revocation; Capacitor unregister() does not await Android deleteToken().
      if(previous)await revoke(previous,!token);
      if(generation!==epoch)return state;
      if(!state.supported){if(token && storage.getItem(OPT_IN_KEY)==="true")await revoke(token);return state;}
      if(token && storage.getItem(OPT_IN_KEY)==="true")return start(token,generation,false);
      return state;
    });
  }
  function enable(token){
    const ready=setAuth(token);
    return ready.then(()=>serialize(()=>start(auth,epoch,true))).catch(error=>{if(!Object.values(messages).includes(error.message))throw problem("registration");throw error;});
  }
  function disable(token=auth){
    auth="";cancel();storage.removeItem(OPT_IN_KEY);
    return serialize(async()=>{await clearListeners();if(platform==="android")await revoke(token);return state;});
  }
  function resume(){
    const token=auth,generation=epoch;
    if(!token || !state.supported || storage.getItem(OPT_IN_KEY)!=="true")return Promise.resolve(state);
    return serialize(()=>generation===epoch?start(token,generation,false):state);
  }
  return {setAuth,enable,disable,resume,status:()=>({...state}),installationId};
}
