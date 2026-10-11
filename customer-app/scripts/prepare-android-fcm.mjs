import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_FIREBASE_PROJECT_ID="aqaba-seago-7c92";
export const EXPECTED_ANDROID_PACKAGE="com.aqabaseago.app";
export const GOOGLE_SERVICES_PLUGIN_VERSION="4.4.4";

export function validateFirebaseAndroidConfig(config){
  if(!config||typeof config!=="object")throw new Error("Firebase Android config must be a JSON object");
  const projectId=String(config?.project_info?.project_id||"").trim();
  if(projectId!==EXPECTED_FIREBASE_PROJECT_ID)throw new Error("Firebase project_id mismatch");
  const packages=(Array.isArray(config.client)?config.client:[])
    .map(item=>String(item?.client_info?.android_client_info?.package_name||"").trim())
    .filter(Boolean);
  if(!packages.includes(EXPECTED_ANDROID_PACKAGE))throw new Error("Firebase Android package_name mismatch");
  return {projectId,packageName:EXPECTED_ANDROID_PACKAGE};
}

export function decodeFirebaseAndroidConfig(encoded,{required=false}={}){
  const compact=String(encoded||"").replace(/\s+/g,"");
  if(!compact){
    if(required)throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 is required for a native FCM build");
    return null;
  }
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(compact))throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 is not valid base64");
  let config;
  try{config=JSON.parse(Buffer.from(compact,"base64").toString("utf8"));}
  catch{throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 does not contain valid JSON");}
  validateFirebaseAndroidConfig(config);
  return config;
}

function ensureRootPlugin(text){
  if(text.includes("com.google.gms:google-services"))return text;
  const marker="dependencies {";
  const index=text.indexOf(marker);
  if(index<0)throw new Error("Generated Android root build.gradle has no buildscript dependencies block");
  const insertion=`${marker}\n        classpath 'com.google.gms:google-services:${GOOGLE_SERVICES_PLUGIN_VERSION}'`;
  return text.slice(0,index)+text.slice(index).replace(marker,insertion,1);
}

function ensureAppPlugin(text){
  if(text.includes("apply plugin: 'com.google.gms.google-services'")||text.includes('apply plugin: "com.google.gms.google-services"'))return text;
  return `${text.trimEnd()}\n\ntry {\n    def servicesJSON = file('google-services.json')\n    if (servicesJSON.text) {\n        apply plugin: 'com.google.gms.google-services'\n    }\n} catch(Exception e) {\n    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")\n}\n`;
}

export function ensureGoogleServicesGradle(androidDir){
  const rootGradle=path.join(androidDir,"build.gradle");
  const appGradle=path.join(androidDir,"app","build.gradle");
  if(!fs.existsSync(rootGradle)||!fs.existsSync(appGradle))throw new Error("Generated Android project is missing expected Gradle files");
  fs.writeFileSync(rootGradle,ensureRootPlugin(fs.readFileSync(rootGradle,"utf8")));
  fs.writeFileSync(appGradle,ensureAppPlugin(fs.readFileSync(appGradle,"utf8")));
}

export function prepareAndroidFcm({cwd=process.cwd(),encoded=process.env.FIREBASE_ANDROID_CONFIG_BASE64,required=false}={}){
  const androidDir=path.join(cwd,"android");
  ensureGoogleServicesGradle(androidDir);
  const config=decodeFirebaseAndroidConfig(encoded,{required});
  if(!config)return {configured:false};
  const target=path.join(androidDir,"app","google-services.json");
  fs.writeFileSync(target,`${JSON.stringify(config,null,2)}\n`,{mode:0o600});
  return {configured:true,target};
}

function main(){
  const required=process.argv.includes("--require-config");
  const result=prepareAndroidFcm({required});
  console.log(JSON.stringify({
    event:"android_fcm_config",
    result:result.configured?"configured":"skipped",
    projectId:EXPECTED_FIREBASE_PROJECT_ID,
    packageName:EXPECTED_ANDROID_PACKAGE
  }));
}

const invoked=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:"";
if(import.meta.url===invoked){
  try{main();}
  catch(error){console.error(JSON.stringify({event:"android_fcm_config",result:"failed",code:String(error?.message||"configuration_failed")}));process.exit(1);}
}
