import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_PUSH_CONTEXT } from "../shared/nativePushContext.js";
import { validateNativeFcmStartup } from "../src/services/nativeFcm.js";

const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const safeTestPrivateKey=privateKey.export({type:"pkcs8",format:"pem"});
const tempDirs=[];

test.after(()=>{
  for(const dir of tempDirs)rmSync(dir,{recursive:true,force:true});
});

function writeCredential(contents){
  const dir=mkdtempSync(join(tmpdir(),"seago-fcm-startup-"));
  tempDirs.push(dir);
  const file=join(dir,"service-account.json");
  writeFileSync(file,contents,{mode:0o600});
  return file;
}

function serviceAccount(projectId=NATIVE_PUSH_CONTEXT.firebaseProjectId){
  return {
    type:"service_account",
    project_id:projectId,
    private_key_id:"test-only-not-a-secret",
    private_key:safeTestPrivateKey,
    client_email:`test-only@${projectId}.iam.gserviceaccount.com`
  };
}

function enabledEnv(path){
  return {
    FCM_ENABLED:"true",
    FIREBASE_PROJECT_ID:NATIVE_PUSH_CONTEXT.firebaseProjectId,
    GOOGLE_APPLICATION_CREDENTIALS:path
  };
}

test("FCM startup validation is a no-op when FCM is disabled and credentials are absent",()=>{
  assert.deepEqual(validateNativeFcmStartup({FCM_ENABLED:"false"}),{enabled:false,ready:true});
  assert.deepEqual(validateNativeFcmStartup({}),{enabled:false,ready:true});
});

test("FCM startup fails closed when enabled and GOOGLE_APPLICATION_CREDENTIALS is missing",()=>{
  assert.throws(()=>validateNativeFcmStartup({FCM_ENABLED:"true",FIREBASE_PROJECT_ID:NATIVE_PUSH_CONTEXT.firebaseProjectId}),error=>{
    assert.equal(error.message,"fcm_configuration_invalid");
    return true;
  });
});

test("FCM startup fails closed when FIREBASE_PROJECT_ID is missing or wrong",()=>{
  const path=writeCredential(JSON.stringify(serviceAccount()));
  for(const projectId of [undefined,"wrong-project"]){
    assert.throws(()=>validateNativeFcmStartup({FCM_ENABLED:"true",FIREBASE_PROJECT_ID:projectId,GOOGLE_APPLICATION_CREDENTIALS:path}),/fcm_configuration_invalid/);
  }
});

test("FCM startup fails closed when credential path does not exist",()=>{
  assert.throws(()=>validateNativeFcmStartup(enabledEnv(join(tmpdir(),"definitely-missing-seago-fcm.json"))),/fcm_configuration_invalid/);
});

test("FCM startup fails closed for malformed credential JSON without exposing its contents",()=>{
  const leakMarker="PRIVATE-KEY-CONTENT-MUST-NOT-LEAK";
  const path=writeCredential(`{\"type\":\"service_account\",\"private_key\":\"${leakMarker}\"`);
  const logs=[];
  const originals={log:console.log,warn:console.warn,error:console.error};
  console.log=(...args)=>logs.push(args.join(" "));
  console.warn=(...args)=>logs.push(args.join(" "));
  console.error=(...args)=>logs.push(args.join(" "));
  try{
    let caught;
    try{validateNativeFcmStartup(enabledEnv(path));}catch(error){caught=error;}
    assert.ok(caught);
    assert.equal(caught.message,"fcm_configuration_invalid");
    assert.doesNotMatch(JSON.stringify({message:caught.message,logs}),new RegExp(leakMarker));
    assert.doesNotMatch(JSON.stringify({message:caught.message,logs}),/private_key|client_email|private_key_id/);
  }finally{
    console.log=originals.log;console.warn=originals.warn;console.error=originals.error;
  }
});

test("FCM startup fails closed for a service account from the wrong Firebase project",()=>{
  const path=writeCredential(JSON.stringify(serviceAccount("another-firebase-project")));
  assert.throws(()=>validateNativeFcmStartup(enabledEnv(path)),/fcm_configuration_invalid/);
});

test("FCM startup rejects invalid service-account structure",()=>{
  const path=writeCredential(JSON.stringify({type:"service_account",project_id:NATIVE_PUSH_CONTEXT.firebaseProjectId,client_email:"test-only@example.invalid"}));
  assert.throws(()=>validateNativeFcmStartup(enabledEnv(path)),/fcm_configuration_invalid/);
});

test("server validates enabled FCM before database connection and before listen readiness",()=>{
  const source=readFileSync(new URL("../src/server.js",import.meta.url),"utf8");
  const validationIndex=source.indexOf("validateNativeFcmStartup(process.env);");
  const connectIndex=source.indexOf("await connectDb(process.env.MONGODB_URI);");
  const listenIndex=source.indexOf("app.listen(port");
  assert.ok(validationIndex>=0);
  assert.ok(connectIndex>validationIndex);
  assert.ok(listenIndex>connectIndex);
});

test("valid expected Firebase service-account fixture passes startup readiness without sending FCM",()=>{
  const path=writeCredential(JSON.stringify(serviceAccount()));
  assert.deepEqual(validateNativeFcmStartup(enabledEnv(path)),{enabled:true,ready:true});
});
