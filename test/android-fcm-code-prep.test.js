import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken, {
  NATIVE_PUSH_APP_ID,
  NATIVE_PUSH_FIREBASE_PROJECT_ID
} from "../src/models/NativePushToken.js";
import NativePushInstallationState from "../src/models/NativePushInstallationState.js";
import { sendAndroidFcmToUser, classifyFcmFailure } from "../src/services/nativePush.js";
import { sendNotificationChannelsToUser } from "../src/services/notificationChannels.js";
import { nativePushFeatureEnabled, resolvePushChannel } from "../customer-app/src/nativePushConfig.js";
import { decodeFirebaseAndroidConfig, validateFirebaseAndroidConfig } from "../customer-app/scripts/prepare-android-fcm.mjs";

const CUSTOMER="507f1f77bcf86cd799439011";
const PROVIDER="507f191e810c19729de860ea";
const ADMIN="507f1f77bcf86cd799439012";
const INSTALLATION="installation_1234567890";
const TOKEN="fcm-test-token-abcdefghijklmnopqrstuvwxyz-0123456789";

function authToken(id){return jwt.sign({sub:id,ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}
function same(left,right){return String(left)===String(right);}
function matches(row,filter){return Object.entries(filter).every(([key,value])=>same(row[key],value));}
function applyUpdate(row,update){
  if(update.$set)Object.assign(row,update.$set);
  if(update.$inc)for(const [key,value] of Object.entries(update.$inc))row[key]=Number(row[key]||0)+Number(value);
  if(update.$unset)for(const key of Object.keys(update.$unset))delete row[key];
  return row;
}
function duplicate(){const error=new Error("duplicate");error.code=11000;return error;}
function makeStore(){
  const states=[];const tokens=[];let next=1;
  return {states,tokens,
    stateFind:async filter=>states.find(row=>matches(row,filter))||null,
    stateUpdate:async(filter,update,options={})=>{
      let row=states.find(item=>matches(item,filter));
      if(!row&&options.upsert){
        const candidate={_id:`s-${next++}`,...filter};
        if(states.some(item=>item.appId===candidate.appId&&item.installationId===candidate.installationId))throw duplicate();
        row=applyUpdate(candidate,update);states.push(row);
      }else if(row)applyUpdate(row,update);
      return row?{...row}:null;
    },
    stateCreate:async docs=>docs.map(doc=>{
      if(states.some(item=>item.appId===doc.appId&&item.installationId===doc.installationId))throw duplicate();
      const row={_id:`s-${next++}`,...doc};states.push(row);return {...row};
    }),
    tokenFind:async filter=>tokens.find(row=>matches(row,filter))||null,
    tokenUpdate:async(filter,update,options={})=>{
      let row=tokens.find(item=>matches(item,filter));
      if(!row&&options.upsert){
        const candidate={_id:`t-${next++}`,...filter,...(update.$set||{})};
        if(tokens.some(item=>item.token===candidate.token||(item.appId===candidate.appId&&item.installationId===candidate.installationId)))throw duplicate();
        row=candidate;tokens.push(row);
      }else if(row){
        const candidate=applyUpdate({...row},update);
        if(tokens.some(item=>item._id!==row._id&&(item.token===candidate.token||(item.appId===candidate.appId&&item.installationId===candidate.installationId))))throw duplicate();
        Object.assign(row,candidate);
      }
      return row?{...row}:null;
    },
    tokenDelete:async filter=>{
      let count=0;for(let i=tokens.length-1;i>=0;i--){if(matches(tokens[i],filter)){tokens.splice(i,1);count++;}}
      return {deletedCount:count};
    }
  };
}

async function startApp(){
  const app=express();app.use(express.json());app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
async function post(baseUrl,path,token,body={}){
  const response=await fetch(baseUrl+path,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}

async function withAuthHarness(run){
  const oldSecret=process.env.JWT_SECRET;
  const oldFindById=User.findById;
  const oldStartSession=mongoose.startSession;
  const oldStateFind=NativePushInstallationState.findOne;
  const oldStateUpdate=NativePushInstallationState.findOneAndUpdate;
  const oldStateCreate=NativePushInstallationState.create;
  const oldTokenFind=NativePushToken.findOne;
  const oldTokenUpdate=NativePushToken.findOneAndUpdate;
  const oldTokenDelete=NativePushToken.deleteMany;
  const store=makeStore();
  process.env.JWT_SECRET="android-fcm-code-prep-test-secret-123456789";
  const users=new Map([
    [CUSTOMER,{_id:CUSTOMER,role:"customer",isActive:true,authVersion:0}],
    [PROVIDER,{_id:PROVIDER,role:"provider",isActive:true,authVersion:0}],
    [ADMIN,{_id:ADMIN,role:"admin",isActive:true,authVersion:0}]
  ]);
  User.findById=id=>({select:async()=>users.get(String(id))||null});
  mongoose.startSession=async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}});
  NativePushInstallationState.findOne=store.stateFind;
  NativePushInstallationState.findOneAndUpdate=store.stateUpdate;
  NativePushInstallationState.create=store.stateCreate;
  NativePushToken.findOne=store.tokenFind;
  NativePushToken.findOneAndUpdate=store.tokenUpdate;
  NativePushToken.deleteMany=store.tokenDelete;
  try{await run(store);}
  finally{
    User.findById=oldFindById;mongoose.startSession=oldStartSession;
    NativePushInstallationState.findOne=oldStateFind;NativePushInstallationState.findOneAndUpdate=oldStateUpdate;NativePushInstallationState.create=oldStateCreate;
    NativePushToken.findOne=oldTokenFind;NativePushToken.findOneAndUpdate=oldTokenUpdate;NativePushToken.deleteMany=oldTokenDelete;
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  }
}

test("native endpoints are customer-only and Android registration stores explicit FCM metadata with an epoch fence",async()=>withAuthHarness(async store=>{
  const {server,baseUrl}=await startApp();
  try{
    const customer=authToken(CUSTOMER),provider=authToken(PROVIDER),admin=authToken(ADMIN);
    const payload={token:TOKEN,platform:"android",installationId:INSTALLATION,lifecycleEpoch:1};
    const subscribed=await post(baseUrl,"/api/push/native-subscribe",customer,payload);
    assert.equal(subscribed.status,200);
    assert.equal(subscribed.body.lifecycleEpoch,1);
    assert.equal((await post(baseUrl,"/api/push/native-subscribe",provider,payload)).status,403);
    assert.equal((await post(baseUrl,"/api/push/native-subscribe",admin,payload)).status,403);
    assert.equal(store.tokens.length,1);
    assert.equal(store.tokens[0].provider,"fcm");
    assert.equal(store.tokens[0].firebaseProjectId,NATIVE_PUSH_FIREBASE_PROJECT_ID);
    assert.equal(store.tokens[0].appId,NATIVE_PUSH_APP_ID);
    assert.equal(store.tokens[0].platform,"android");
    assert.equal(store.states.length,1);
    assert.equal(store.states[0].currentEpoch,1);
    assert.equal(store.states[0].active,true);
    assert.equal((await post(baseUrl,"/api/push/native-unsubscribe",provider,{installationId:INSTALLATION,lifecycleEpoch:1})).status,403);
    assert.equal((await post(baseUrl,"/api/push/native-unsubscribe",admin,{installationId:INSTALLATION,lifecycleEpoch:1})).status,403);
    const revoked=await post(baseUrl,"/api/push/native-unsubscribe",customer,{installationId:INSTALLATION,lifecycleEpoch:1});
    assert.equal(revoked.status,200);
    assert.equal(revoked.body.lifecycleEpoch,2);
    assert.equal(store.tokens.length,0);
    assert.equal(store.states[0].currentEpoch,2);
    assert.equal(store.states[0].active,false);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test("cross-installation duplicate token conflicts fail closed without silent reassignment",async()=>withAuthHarness(async store=>{
  store.tokens.push({_id:"existing",userId:CUSTOMER,appId:NATIVE_PUSH_APP_ID,installationId:"installation_other_123456",token:TOKEN,platform:"android",provider:"fcm"});
  const {server,baseUrl}=await startApp();
  try{
    const response=await post(baseUrl,"/api/push/native-subscribe",authToken(CUSTOMER),{token:TOKEN,platform:"android",installationId:INSTALLATION,lifecycleEpoch:1});
    assert.equal(response.status,409);
    assert.equal(response.body.code,"NATIVE_PUSH_CREDENTIAL_CONFLICT");
    assert.equal(store.tokens.length,1);
    assert.equal(store.tokens[0].installationId,"installation_other_123456");
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test("schema defaults Android to FCM metadata and iOS to APNs without an iOS FCM bridge",async()=>{
  const android=new NativePushToken({userId:CUSTOMER,token:TOKEN,installationId:INSTALLATION,platform:"android"});
  await android.validate();
  assert.equal(android.provider,"fcm");
  assert.equal(android.firebaseProjectId,NATIVE_PUSH_FIREBASE_PROJECT_ID);
  assert.equal(android.appId,NATIVE_PUSH_APP_ID);
  const ios=new NativePushToken({userId:CUSTOMER,token:"a".repeat(64),installationId:"installation_ios_12345",platform:"ios"});
  await ios.validate();
  assert.equal(ios.provider,"apns");
  assert.equal(ios.firebaseProjectId,undefined);
});

function fcmEnv(extra={}){return {FCM_ENABLED:"true",FIREBASE_PROJECT_ID:NATIVE_PUSH_FIREBASE_PROJECT_ID,GOOGLE_APPLICATION_CREDENTIALS:"/secret/firebase.json",...extra};}
function modelWith(rows){
  const state={deleted:0,updated:0,filter:null};
  return {state,model:{
    find:async filter=>{state.filter=filter;return rows;},
    deleteOne:async()=>{state.deleted++;return {deletedCount:1};},
    updateOne:async()=>{state.updated++;return {modifiedCount:1};}
  }};
}

test("FCM disabled and missing credentials fail closed without touching tokens",async()=>{
  let finds=0;const tokenModel={find:async()=>{finds++;return [];}};
  const disabled=await sendAndroidFcmToUser(CUSTOMER,{}, {env:{FCM_ENABLED:"false"},tokenModel});
  assert.equal(disabled.skipped,true);assert.equal(disabled.reason,"fcm_disabled");assert.equal(finds,0);
  const missing=await sendAndroidFcmToUser(CUSTOMER,{}, {env:fcmEnv(),fileExists:()=>false,tokenModel});
  assert.equal(missing.skipped,true);assert.equal(missing.reason,"fcm_credentials_missing");assert.equal(finds,0);
});

test("mocked Android FCM send is privacy-minimized and does not require VAPID",async()=>{
  const oldPublic=process.env.VAPID_PUBLIC_KEY,oldPrivate=process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;
  const row={_id:"row1",token:TOKEN};const {state,model}=modelWith([row]);let message;
  try{
    const sent=await sendAndroidFcmToUser(CUSTOMER,{title:"Private booking SG-123",body:"Secret details",data:{screen:"tickets",ticketToken:"ticket-secret",authToken:"jwt-secret"}}, {
      env:fcmEnv(),fileExists:()=>true,tokenModel:model,getMessagingClient:async()=>({send:async value=>{message=value;return "mock-id";}}),logger:{log(){},warn(){},error(){}}
    });
    assert.equal(sent.sent,1);assert.equal(state.updated,1);
    assert.equal(state.filter.platform,"android");assert.equal(state.filter.provider,"fcm");
    assert.equal(state.filter.firebaseProjectId,NATIVE_PUSH_FIREBASE_PROJECT_ID);assert.equal(state.filter.appId,NATIVE_PUSH_APP_ID);
    assert.equal(message.notification.title,"Aqaba SeaGo");
    assert.match(message.notification.body,/Open the app to view details/);
    assert.doesNotMatch(JSON.stringify(message),/SG-123|ticket-secret|jwt-secret|Secret details/);
  }finally{
    if(oldPublic===undefined)delete process.env.VAPID_PUBLIC_KEY;else process.env.VAPID_PUBLIC_KEY=oldPublic;
    if(oldPrivate===undefined)delete process.env.VAPID_PRIVATE_KEY;else process.env.VAPID_PRIVATE_KEY=oldPrivate;
  }
});

test("permanent FCM token errors revoke while transient errors preserve token and logs never expose raw token",async()=>{
  const logs=[];const logger={log:value=>logs.push(value),warn:value=>logs.push(value),error:value=>logs.push(value)};
  const permanentModel=modelWith([{_id:"row1",token:TOKEN}]);
  const permanent=await sendAndroidFcmToUser(CUSTOMER,{}, {env:fcmEnv(),fileExists:()=>true,tokenModel:permanentModel.model,getMessagingClient:async()=>({send:async()=>{const e=new Error("provider may echo token");e.code="messaging/registration-token-not-registered";throw e;}}),logger});
  assert.equal(classifyFcmFailure({code:"messaging/registration-token-not-registered"}),"permanent");
  assert.equal(permanentModel.state.deleted,1);assert.equal(permanent.removed,1);
  const transientModel=modelWith([{_id:"row2",token:TOKEN}]);
  const transient=await sendAndroidFcmToUser(CUSTOMER,{}, {env:fcmEnv(),fileExists:()=>true,tokenModel:transientModel.model,getMessagingClient:async()=>({send:async()=>{const e=new Error("temporary");e.code="messaging/internal-error";throw e;}}),logger});
  assert.equal(transientModel.state.deleted,0);assert.equal(transient.failed,1);
  assert.equal(JSON.stringify(logs).includes(TOKEN),false);
  assert.match(JSON.stringify(logs),/[a-f0-9]{16}/);
});

test("Web Push and native FCM channels settle independently",async()=>{
  const result=await sendNotificationChannelsToUser(CUSTOMER,{data:{screen:"notifications"}},{
    webSender:async()=>({sent:1,failed:0,skipped:false}),
    nativeSender:async()=>({sent:0,failed:0,skipped:true,reason:"fcm_disabled"})
  });
  assert.equal(result.webPush.sent,1);assert.equal(result.nativePush.reason,"fcm_disabled");
  const inverse=await sendNotificationChannelsToUser(CUSTOMER,{}, {
    webSender:async()=>{throw new Error("VAPID unavailable");},
    nativeSender:async()=>({sent:1,failed:0,skipped:false})
  });
  assert.equal(inverse.webPush.errorCode,"web_push_channel_failed");assert.equal(inverse.nativePush.sent,1);
});

test("push test endpoint returns independent webPush/nativePush results when FCM is disabled",async()=>withAuthHarness(async()=>{
  const oldEnabled=process.env.FCM_ENABLED;process.env.FCM_ENABLED="false";
  const {server,baseUrl}=await startApp();
  try{
    const response=await post(baseUrl,"/api/push/test",authToken(CUSTOMER));
    assert.equal(response.status,200);
    assert.ok(response.body.webPush);assert.ok(response.body.nativePush);
    assert.equal(response.body.nativePush.skipped,true);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(oldEnabled===undefined)delete process.env.FCM_ENABLED;else process.env.FCM_ENABLED=oldEnabled;
  }
}));

test("customer native feature flag selects only Capacitor Android and leaves web as Web Push",()=>{
  assert.equal(
    nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"false"}),
    false
  );
  assert.equal(resolvePushChannel({enabled:false,isNative:true,platform:"android"}),"native-disabled");
  assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"android"}),"native-android");
  assert.equal(resolvePushChannel({enabled:true,isNative:false,platform:"web"}),"web");
  assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"ios"}),"native-disabled");
});

test("Firebase Android config validation rejects missing, wrong project and wrong package",()=>{
  const valid={project_info:{project_id:NATIVE_PUSH_FIREBASE_PROJECT_ID},client:[{client_info:{android_client_info:{package_name:NATIVE_PUSH_APP_ID}}}]};
  assert.deepEqual(validateFirebaseAndroidConfig(valid),{projectId:NATIVE_PUSH_FIREBASE_PROJECT_ID,packageName:NATIVE_PUSH_APP_ID});
  assert.throws(()=>decodeFirebaseAndroidConfig("",{required:true}),/required/);
  assert.throws(()=>validateFirebaseAndroidConfig({...valid,project_info:{project_id:"wrong"}}),/project_id mismatch/);
  assert.throws(()=>validateFirebaseAndroidConfig({project_info:valid.project_info,client:[{client_info:{android_client_info:{package_name:"wrong.package"}}}]}),/package_name mismatch/);
});

test("repository contains no committed real google-services file or Firebase server secret in VITE config",()=>{
  assert.equal(fs.existsSync(new URL("../customer-app/android/app/google-services.json",import.meta.url)),false);
  const env=fs.readFileSync(new URL("../customer-app/.env.example",import.meta.url),"utf8");
  assert.match(env,/VITE_NATIVE_PUSH_ENABLED=false/);
  assert.doesNotMatch(env,/GOOGLE_APPLICATION_CREDENTIALS|private_key|service_account/);
  const backend=fs.readFileSync(new URL("../.env.example",import.meta.url),"utf8");
  assert.match(backend,/FCM_ENABLED=false/);assert.match(backend,/FIREBASE_PROJECT_ID=aqaba-seago-7c92/);
});
