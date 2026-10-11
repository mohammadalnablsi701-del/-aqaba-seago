import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativePushFeatureEnabled, resolvePushChannel } from "../src/nativePushConfig.js";
import {
  decodeFirebaseAndroidConfig,
  ensureGoogleServicesGradle,
  validateFirebaseAndroidConfig
} from "./prepare-android-fcm.mjs";

const valid={
  project_info:{project_id:"aqaba-seago-7c92"},
  client:[{client_info:{android_client_info:{package_name:"com.aqabaseago.app"}}}]
};

assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"false"}),false);
assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"true"}),true);
assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"android"}),"native-android");
assert.equal(resolvePushChannel({enabled:false,isNative:true,platform:"android"}),"native-disabled");
assert.equal(resolvePushChannel({enabled:true,isNative:false,platform:"web"}),"web");
assert.deepEqual(validateFirebaseAndroidConfig(valid),{projectId:"aqaba-seago-7c92",packageName:"com.aqabaseago.app"});
assert.throws(()=>validateFirebaseAndroidConfig({...valid,project_info:{project_id:"wrong-project"}}),/project_id mismatch/);
assert.throws(()=>validateFirebaseAndroidConfig({project_info:valid.project_info,client:[{client_info:{android_client_info:{package_name:"wrong.package"}}}]}),/package_name mismatch/);
assert.throws(()=>decodeFirebaseAndroidConfig("",{required:true}),/required/);
const encoded=Buffer.from(JSON.stringify(valid)).toString("base64");
assert.equal(decodeFirebaseAndroidConfig(encoded,{required:true}).project_info.project_id,"aqaba-seago-7c92");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"seago-fcm-"));
try{
  fs.mkdirSync(path.join(tmp,"app"),{recursive:true});
  fs.writeFileSync(path.join(tmp,"build.gradle"),"buildscript {\n    dependencies {\n        classpath 'com.android.tools.build:gradle:8.13.0'\n    }\n}\n");
  fs.writeFileSync(path.join(tmp,"app","build.gradle"),"android { }\n");
  ensureGoogleServicesGradle(tmp);
  assert.match(fs.readFileSync(path.join(tmp,"build.gradle"),"utf8"),/com\.google\.gms:google-services:4\.4\.4/);
  assert.match(fs.readFileSync(path.join(tmp,"app","build.gradle"),"utf8"),/apply plugin: 'com\.google\.gms\.google-services'/);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

console.log("native push config tests passed");
