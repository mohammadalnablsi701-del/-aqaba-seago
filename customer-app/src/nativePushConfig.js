export function nativePushFeatureEnabled(env=import.meta.env){
  return String(env?.VITE_NATIVE_PUSH_ENABLED||"false").trim().toLowerCase()==="true";
}

export function resolvePushChannel({enabled=false,isNative=false,platform="web"}={}){
  if(!isNative)return "web";
  if(platform==="android"&&enabled)return "native-android";
  return "native-disabled";
}
