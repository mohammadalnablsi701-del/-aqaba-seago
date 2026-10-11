import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import router from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken from "../src/models/NativePushToken.js";
import NativePushLifecycle from "../src/models/NativePushLifecycle.js";
import { NATIVE_PUSH_CONTEXT as context } from "../shared/nativePushContext.js";
import { sendNativePushToUser, configuredMessaging } from "../src/services/nativeFcm.js";
import { sendPushToUser, sendWebPushToUser } from "../src/services/push.js";

const token="private-fcm-token-that-must-never-be-logged";
const userId="507f1f77bcf86cd799439011";
const installationId="installation_customer_123";
const registration={...context,token,installationId,lifecycleGeneration:1};
const row={...registration,userId,_id:"binding-1"};

function senderHarness(code){
  const calls={find:[],send:[],deleted:[],updated:[],logs:[]};
  return {calls,options:{env:{FCM_ENABLED:"true"},
    users:{findOne:async filter=>filter.role==="customer"?{_id:userId}:null},
    tokens:{find:async filter=>{calls.find.push(filter);return [row];},deleteOne:async filter=>calls.deleted.push(filter),updateOne:async filter=>calls.updated.push(filter)},
    messaging:()=>({send:async message=>{calls.send.push(message);if(code)throw Object.assign(new Error(token+" private-key"),{code});return "sent";}}),
    log:record=>calls.logs.push(record)
  }};
}

test("FCM defaults off without touching credentials, users or tokens",async()=>{
  for(const value of [undefined,"false","TRUE","1"]){
    const h=senderHarness();h.options.env={FCM_ENABLED:value};
    h.options.users.findOne=()=>assert.fail("disabled must not query users");
    h.options.messaging=()=>assert.fail("disabled must not initialize credentials");
    assert.equal((await sendNativePushToUser(userId,{},h.options)).skipped,true);
    assert.equal(h.calls.find.length,0);
  }
  assert.throws(()=>configuredMessaging({FIREBASE_PROJECT_ID:"wrong"}),/configuration_invalid/);
});

test("Android FCM sends only exact customer app context and generic private content",async()=>{
  const h=senderHarness();
  const result=await sendNativePushToUser(userId,{title:"private booking",body:"secret",data:{screen:"notifications",ticketToken:"private",notificationId:"safe123"}},h.options);
  assert.equal(result.sent,1);
  assert.deepEqual(h.calls.find[0],{...context,userId});
  assert.equal(h.calls.send[0].android.restrictedPackageName,context.appId);
  assert.deepEqual(h.calls.send[0].data,{screen:"notifications",notificationId:"safe123"});
  assert.doesNotMatch(JSON.stringify(h.calls.send[0].notification),/private booking|secret/);
  assert.equal(h.calls.updated.length,1);
  h.options.users.findOne=async()=>null;
  assert.equal((await sendNativePushToUser(userId,{},h.options)).skipped,true);
});

test("permanently invalid FCM tokens are compare-and-deleted without leaking raw credentials",async()=>{
  for(const code of ["messaging/registration-token-not-registered","messaging/invalid-registration-token"]){
    const h=senderHarness(code);
    const result=await sendNativePushToUser(userId,{},h.options);
    assert.equal(result.permanentFailures,1);
    assert.deepEqual(h.calls.deleted,[{...context,userId,_id:row._id,token,installationId}]);
    assert.doesNotMatch(JSON.stringify(h.calls.logs),/private-fcm|private-key/);
    assert.match(h.calls.logs[0].credentialFingerprint,/^[a-f0-9]{16}$/);
  }
});

test("transient, auth, wrong-project and payload failures never delete tokens",async()=>{
  for(const code of ["messaging/server-unavailable","messaging/internal-error","messaging/quota-exceeded","messaging/mismatched-credential","messaging/authentication-error","messaging/invalid-argument","unrecognized-private-error"]){
    const h=senderHarness(code);
    assert.equal((await sendNativePushToUser(userId,{},h.options)).failed,1);
    assert.equal(h.calls.deleted.length,0);
    assert.doesNotMatch(JSON.stringify(h.calls.logs),/private-fcm|private-key|unrecognized-private/);
  }
});

test("browser Web Push and native sending are independent of each other's config and failure",async()=>{
  const old=process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PUBLIC_KEY;
  try{
    const result=await sendPushToUser(userId,{}, {web:sendWebPushToUser,native:async()=>({sent:1,failed:0,skipped:false})});
    assert.equal(result.sent,1);assert.equal(result.channels.web_push.skipped,true);
    const nativeOff=await sendPushToUser(userId,{}, {web:async()=>({sent:1,failed:0,skipped:false}),native:()=>sendNativePushToUser(userId,{}, {env:{}})});
    assert.equal(nativeOff.sent,1);assert.equal(nativeOff.channels.android_fcm.skipped,true);
    const original=console.error;const logs=[];console.error=value=>logs.push(value);
    try{
      const failed=await sendPushToUser(userId,{}, {web:async()=>{throw new Error(token);},native:async()=>({sent:1,failed:0,skipped:false})});
      assert.equal(failed.sent,1);assert.doesNotMatch(JSON.stringify(logs),/private-fcm/);
    }finally{console.error=original;}
  }finally{if(old===undefined)delete process.env.VAPID_PUBLIC_KEY;else process.env.VAPID_PUBLIC_KEY=old;}
});

test("native routes enforce customer role, Android context, lifecycle generation, ownership, disabled state and safe DB errors",async()=>{
  const originals={
    find:User.findById,
    upsert:NativePushToken.findOneAndUpdate,
    remove:NativePushToken.deleteMany,
    lifecycleFind:NativePushLifecycle.findOne,
    lifecycleUpsert:NativePushLifecycle.findOneAndUpdate,
    startSession:mongoose.startSession,
    secret:process.env.JWT_SECRET,
    enabled:process.env.FCM_ENABLED
  };
  process.env.JWT_SECRET="android-fcm-isolated-test-signing-secret";
  process.env.FCM_ENABLED="true";
  const writes=[],removals=[],fenceWrites=[];let fence=null;
  let dbError=false;
  User.findById=id=>({select:async()=>({_id:id,role:id===userId?"customer":id==="507f1f77bcf86cd799439012"?"provider":"admin",isActive:true,authVersion:0})});
  mongoose.startSession=async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}});
  NativePushLifecycle.findOne=filter=>({session:()=>({lean:async()=>fence&&String(fence.userId)===String(filter.userId)&&fence.installationId===filter.installationId?{...fence}:null})});
  NativePushLifecycle.findOneAndUpdate=async(filter,update,options)=>{
    fence={...filter,...update.$set};fenceWrites.push({filter,update,options});return fence;
  };
  NativePushToken.findOneAndUpdate=async(filter,update,options)=>{
    if(dbError)throw Object.assign(new Error(token),{code:11000});
    writes.push({filter,update,options});return {};
  };
  NativePushToken.deleteMany=filter=>({session:async()=>{removals.push(filter);return {deletedCount:1};}});
  const app=express();app.use(express.json());app.use("/api/push",router);
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  async function post(path,body,id=userId){
    const auth=id?jwt.sign({sub:id,ver:0},process.env.JWT_SECRET):null;
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/push/${path}`,{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  }
  try{
    assert.equal((await post("native-subscribe",registration,null)).status,401);
    for(const id of ["507f1f77bcf86cd799439012","507f1f77bcf86cd799439013"]){
      assert.equal((await post("native-subscribe",registration,id)).status,403);
      assert.equal((await post("native-unsubscribe",{installationId,lifecycleGeneration:2},id)).status,403);
    }
    for(const bad of [{platform:"ios"},{provider:"apns"},{firebaseProjectId:"wrong"},{firebaseAppId:"wrong"},{appId:"other.app"}])assert.equal((await post("native-subscribe",{...registration,...bad})).status,400);
    assert.equal((await post("native-subscribe",{...registration,lifecycleGeneration:undefined})).status,400);
    assert.equal(writes.length,0);
    assert.deepEqual(await post("native-subscribe",registration),{status:200,body:{ok:true}});
    assert.deepEqual(writes[0].filter,{appId:context.appId,installationId,userId});
    assert.deepEqual(Object.fromEntries(Object.keys(context).map(k=>[k,writes[0].update.$set[k]])),context);
    assert.equal(writes[0].update.$set.token,token);
    assert.equal(writes[0].options.runValidators,true);
    assert.equal(writes[0].options.session!=null,true);
    assert.equal(fenceWrites[0].update.$set.generation,1);
    assert.equal(fenceWrites[0].update.$set.state,"active");

    const revoke=await post("native-unsubscribe",{installationId,lifecycleGeneration:2});
    assert.equal(revoke.status,200);
    assert.deepEqual(removals,[{appId:context.appId,installationId,userId}]);
    assert.equal(fence.state,"revoked");assert.equal(fence.generation,2);
    const stale=await post("native-subscribe",{...registration,lifecycleGeneration:1});
    assert.equal(stale.status,409);assert.doesNotMatch(JSON.stringify(stale),/private-fcm/);
    assert.equal(writes.length,1);

    process.env.FCM_ENABLED="false";
    assert.equal((await post("native-subscribe",registration)).status,503);
    assert.equal((await post("native-unsubscribe",{installationId,lifecycleGeneration:3})).status,200);
    process.env.FCM_ENABLED="true";fence=null;dbError=true;
    const failed=await post("native-subscribe",{...registration,lifecycleGeneration:4});
    assert.equal(failed.status,409);assert.doesNotMatch(JSON.stringify(failed),/private-fcm/);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    User.findById=originals.find;NativePushToken.findOneAndUpdate=originals.upsert;NativePushToken.deleteMany=originals.remove;
    NativePushLifecycle.findOne=originals.lifecycleFind;NativePushLifecycle.findOneAndUpdate=originals.lifecycleUpsert;mongoose.startSession=originals.startSession;
    for(const [name,value] of [["JWT_SECRET",originals.secret],["FCM_ENABLED",originals.enabled]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
