import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_PUSH_CONTEXT as context } from "../../shared/nativePushContext.js";

export function decodeAndroidConfig(encoded) {
  if (!encoded || encoded.length > 131072 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Invalid Firebase Android configuration encoding");
  let config;
  try { config = JSON.parse(Buffer.from(encoded,"base64").toString("utf8")); }
  catch { throw new Error("Invalid Firebase Android configuration JSON"); }
  const clients = config.client;
  if (config.project_info?.project_id !== context.firebaseProjectId || String(config.project_info?.project_number) !== "173154283669") throw new Error("Firebase project mismatch");
  if (!Array.isArray(clients) || clients.length !== 1 ||
      clients[0].client_info?.android_client_info?.package_name !== context.appId ||
      clients[0].client_info?.mobilesdk_app_id !== context.firebaseAppId) throw new Error("Firebase Android app/package mismatch");
  if (!clients[0].api_key?.some(key=>typeof key.current_key === "string" && key.current_key.length > 10)) throw new Error("Firebase client API key missing");
  return config;
}

export function configureAndroidFirebase({root=process.cwd(),env=process.env}={}) {
  const app=path.join(root,"android/app");
  if (!fs.existsSync(app)) throw new Error("Generate the Android project before configuring Firebase");
  const target=path.join(app,"google-services.json");
  const encoded=env.FIREBASE_ANDROID_CONFIG_BASE64;
  if (encoded) {
    const config=decodeAndroidConfig(encoded);
    fs.writeFileSync(target,JSON.stringify(config,null,2)+"\n",{mode:0o600});
  } else if (fs.existsSync(target)) {
    decodeAndroidConfig(fs.readFileSync(target).toString("base64"));
  } else if (env.VITE_NATIVE_PUSH_ENABLED === "true") {
    throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 is required for native push builds");
  }
  const gradle=fs.readFileSync(path.join(app,"build.gradle"),"utf8");
  if (!gradle.includes("com.google.gms.google-services")) throw new Error("Generated Android Google Services plugin missing");
  if (!/applicationId\s+["']com\.aqabaseago\.app["']/.test(gradle)) throw new Error("Generated Android applicationId mismatch");
  const manifest=path.join(app,"src/main/AndroidManifest.xml");
  let xml=fs.readFileSync(manifest,"utf8");
  const values={firebase_messaging_auto_init_enabled:env.VITE_NATIVE_PUSH_ENABLED === "true" ? "true" : "false",firebase_analytics_collection_enabled:"false"};
  for (const [name,value] of Object.entries(values)) {
    const tag=`<meta-data android:name="${name}" android:value="${value}" />`;
    const pattern=new RegExp(`<meta-data\\s+android:name="${name}"[^>]*\\/?>`,"g");
    xml=pattern.test(xml)?xml.replace(pattern,tag):xml.replace("</application>",`    ${tag}\n    </application>`);
  }
  fs.writeFileSync(manifest,xml);
  return {configured:fs.existsSync(target),enabled:env.VITE_NATIVE_PUSH_ENABLED === "true"};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(configureAndroidFirebase())); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
