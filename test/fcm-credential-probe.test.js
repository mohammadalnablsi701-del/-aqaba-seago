import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_PUSH_CONTEXT } from "../shared/nativePushContext.js";
import { probeNativeFcmCredentials } from "../src/services/nativeFcm.js";

const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const testKey=privateKey.export({type:"pkcs8",format:"pem"});
const tempDirs=[];

test.after(()=>{
  for(const dir of tempDirs)rmSync(dir,{recursive:true,force:true});
});

function writeCredential(projectId=NATIVE_PUSH_CONTEXT.firebaseProjectId){
  const dir=mkdtempSync(join(tmpdir(),"seago-fcm-probe-"));
  tempDirs.push(dir);
  const file=join(dir,"service-account.json");
  writeFileSync(file,JSON.stringify({
    type:"service_account",
    project_id:projectId,
    private_key_id:"fixture",
    private_key:testKey,
    client_email:`fixture@${projectId}.iam.gserviceaccount.com`
  }),{mode:0o600});
  return file;
}

function envFor(path){
  return {
    FCM_ENABLED:"false",
    FIREBASE_PROJECT_ID:NATIVE_PUSH_CONTEXT.firebaseProjectId,
    GOOGLE_APPLICATION_CREDENTIALS:path
  };
}

test("credential probe validates the expected project without sending FCM",async()=>{
  const path=writeCredential();
  let authCalls=0;
  const result=await probeNativeFcmCredentials(envFor(path),{
    credentialFactory:()=>({getAccessToken:async()=>{authCalls++;return {access_token:"ok"};}})
  });
  assert.equal(authCalls,1);
  assert.deepEqual(result,{
    event:"fcm_credential_probe",
    credential_present:true,
    env_project_ok:true,
    credential_project_ok:true,
    service_account_type_ok:true,
    client_email_present:true,
    private_key_present:true,
    private_key_parseable:true,
    google_auth_ok:true
  });
});

test("credential probe rejects a wrong project before auth",async()=>{
  const path=writeCredential("wrong-project");
  let authCalls=0;
  const result=await probeNativeFcmCredentials(envFor(path),{
    credentialFactory:()=>({getAccessToken:async()=>{authCalls++;return {access_token:"ok"};}})
  });
  assert.equal(authCalls,0);
  assert.equal(result.credential_project_ok,false);
  assert.equal(result.google_auth_ok,false);
});

test("server keeps the probe behind the explicit flag before normal startup",()=>{
  const source=readFileSync(new URL("../src/server.js",import.meta.url),"utf8");
  const gateIndex=source.indexOf('process.env.FCM_CREDENTIAL_PROBE==="true"');
  const probeIndex=source.indexOf("await probeNativeFcmCredentials(process.env)");
  const validationIndex=source.indexOf("validateNativeFcmStartup(process.env);");
  const connectIndex=source.indexOf("await connectDb(process.env.MONGODB_URI);");
  assert.ok(gateIndex>=0);
  assert.ok(probeIndex>gateIndex);
  assert.ok(validationIndex>probeIndex);
  assert.ok(connectIndex>validationIndex);
});
