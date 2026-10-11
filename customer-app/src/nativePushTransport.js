import { getApiBase } from "./api.js";

const DEFAULT_TIMEOUT_MS=4000;

async function nativePushRequest(path,{token,body,timeoutMs=DEFAULT_TIMEOUT_MS,fetchImpl=globalThis.fetch}={}){
  const base=getApiBase();
  if(!base)throw new Error("API_NOT_CONFIGURED");
  const duration=Number.isFinite(Number(timeoutMs))&&Number(timeoutMs)>0?Number(timeoutMs):DEFAULT_TIMEOUT_MS;
  const controller=typeof AbortController!=="undefined"?new AbortController():null;
  let timer;
  const timedOut=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      try{controller?.abort();}catch{}
      const error=new Error("Native push request timed out");
      error.code="NATIVE_PUSH_REQUEST_TIMEOUT";
      reject(error);
    },duration);
  });
  try{
    const response=await Promise.race([
      fetchImpl(`${base}${path}`,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          ...(token?{Authorization:`Bearer ${token}`}:{})
        },
        body:JSON.stringify(body||{}),
        ...(controller?{signal:controller.signal}:{})
      }),
      timedOut
    ]);
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=new Error(payload.error||`Request failed: ${response.status}`);
      error.status=response.status;
      error.code=payload.code;
      throw error;
    }
    return payload;
  }finally{
    if(timer)clearTimeout(timer);
  }
}

export const registerNativePushToken=({token:deviceToken,platform,installationId,lifecycleEpoch},token,options={})=>nativePushRequest(
  "/api/push/native-subscribe",
  {...options,token,body:{token:deviceToken,platform,installationId,lifecycleEpoch}}
);

export const unregisterNativePushToken=({installationId,lifecycleEpoch},token,options={})=>nativePushRequest(
  "/api/push/native-unsubscribe",
  {...options,token,body:{installationId,lifecycleEpoch}}
);

export const nativePushTransportInternals={nativePushRequest,DEFAULT_TIMEOUT_MS};
