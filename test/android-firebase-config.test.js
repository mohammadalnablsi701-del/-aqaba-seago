import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeAndroidConfig,configureAndroidFirebase } from "../customer-app/scripts/configure-android-firebase.mjs";
import { NATIVE_PUSH_CONTEXT as context } from "../shared/nativePushContext.js";

const config=()=>({project_info:{project_id:context.firebaseProjectId,project_number:"173154283669"},client:[{client_info:{mobilesdk_app_id:context.firebaseAppId,android_client_info:{package_name:context.appId}},api_key:[{current_key:"public-client-test-key"}]}]});
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64");
test("Android config rejects wrong project, package, app ID, malformed and mixed clients",()=>{
  assert.deepEqual(decodeAndroidConfig(encode(config())),config());
  for(const change of [c=>c.project_info.project_id="wrong",c=>c.project_info.project_number="12",c=>c.client[0].client_info.android_client_info.package_name="wrong",c=>c.client[0].client_info.mobilesdk_app_id="wrong",c=>c.client.push(c.client[0])]){
    const c=config();change(c);assert.throws(()=>decodeAndroidConfig(encode(c)),/mismatch/);
  }
  for(const value of ["","not base64",Buffer.from("secret not JSON").toString("base64")])assert.throws(()=>decodeAndroidConfig(value),/Invalid/);
});
test("regenerated Android projects receive the reproducible Firebase delete-token bridge and validated config",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"seago-fcm-"));
  try{
    const app=path.join(root,"android/app");const packageDir=path.join(app,"src/main/java/com/aqabaseago/app");
    fs.mkdirSync(packageDir,{recursive:true});
    fs.writeFileSync(path.join(packageDir,"MainActivity.java"),"package com.aqabaseago.app;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n");
    fs.mkdirSync(path.join(app,"src/main"),{recursive:true});
    fs.writeFileSync(path.join(app,"build.gradle"),'applicationId "com.aqabaseago.app"\napply plugin: "com.google.gms.google-services"');
    const manifest=path.join(app,"src/main/AndroidManifest.xml");fs.writeFileSync(manifest,"<manifest><application></application></manifest>");
    assert.throws(()=>configureAndroidFirebase({root,env:{VITE_NATIVE_PUSH_ENABLED:"true"}}),/required/);
    assert.deepEqual(configureAndroidFirebase({root,env:{}}),{configured:false,enabled:false});
    assert.match(fs.readFileSync(manifest,"utf8"),/firebase_messaging_auto_init_enabled" android:value="false/);
    const bridge=fs.readFileSync(path.join(packageDir,"SeaGoFirebasePlugin.java"),"utf8");
    const main=fs.readFileSync(path.join(packageDir,"MainActivity.java"),"utf8");
    assert.match(bridge,/deleteToken/);assert.match(bridge,/addOnCompleteListener/);assert.match(bridge,new RegExp(context.firebaseProjectId));assert.match(bridge,new RegExp(context.firebaseAppId.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
    assert.match(main,/registerPlugin\(SeaGoFirebasePlugin\.class\)/);
    assert.equal((main.match(/registerPlugin\(SeaGoFirebasePlugin\.class\)/g)||[]).length,1);
    const env={VITE_NATIVE_PUSH_ENABLED:"true",FIREBASE_ANDROID_CONFIG_BASE64:encode(config())};
    configureAndroidFirebase({root,env});configureAndroidFirebase({root,env});
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app,"google-services.json"))),config());
    assert.equal(fs.readFileSync(manifest,"utf8").match(/firebase_messaging_auto_init_enabled/g).length,1);
    assert.equal((fs.readFileSync(path.join(packageDir,"MainActivity.java"),"utf8").match(/registerPlugin\(SeaGoFirebasePlugin\.class\)/g)||[]).length,1);
    const bad=config();bad.project_info.project_id="wrong";
    assert.throws(()=>configureAndroidFirebase({root,env:{FIREBASE_ANDROID_CONFIG_BASE64:encode(bad)}}),/mismatch/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
