import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken from "../src/models/NativePushToken.js";
import NativePushInstallationState from "../src/models/NativePushInstallationState.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const X="installation_A_1234567890";
const Y="installation_B_1234567890";
const T="fcm-token-A-abcdefghijklmnopqrstuvwxyz-0123456789";
const T2="fcm-token-B-abcdefghijklmnopqrstuvwxyz-0123456789";

function tokenFor(userId){return jwt.sign({sub:String(userId),ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}

async function startApp(){
  const app=express();
  app.use(express.json());
  app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}

async function subscribe(baseUrl,authToken,{installationId=X,token=T,lifecycleEpoch=1}={}){
  const response=await fetch(baseUrl+"/api/push/native-subscribe",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${authToken}`},
    body:JSON.stringify({token,platform:"android",installationId,lifecycleEpoch})
  });
  return {status:response.status,body:await response.json()};
}

async function unsubscribe(baseUrl,authToken,{installationId=X,lifecycleEpoch=1}={}){
  const response=await fetch(baseUrl+"/api/push/native-unsubscribe",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${authToken}`},
    body:JSON.stringify({installationId,lifecycleEpoch})
  });
  return {status:response.status,body:await response.json()};
}

test("Mongo-backed native push ownership is fail-closed under claims, refresh and race",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable MongoDB is allowed");
  const previousJwt=process.env.JWT_SECRET;
  process.env.JWT_SECRET="native-push-mongo-p1-test-secret-at-least-32-chars";
  await mongoose.connect(uri,{dbName:"seago_native_push_p1_"+crypto.randomUUID().replaceAll("-","")});
  await Promise.all([User,NativePushToken,NativePushInstallationState].map(model=>model.init()));
  const userA=await User.create({name:"Native Push A",phone:"+962790003001",role:"customer"});
  const userB=await User.create({name:"Native Push B",phone:"+962790003002",role:"customer"});
  const authA=tokenFor(userA._id);
  const authB=tokenFor(userB._id);
  const {server,baseUrl}=await startApp();

  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(previousJwt===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousJwt;
  });

  async function resetA(){
    await Promise.all([NativePushToken.deleteMany({}),NativePushInstallationState.deleteMany({})]);
    assert.equal((await subscribe(baseUrl,authA)).status,200);
  }
  async function onlyRow(){
    const rows=await NativePushToken.find({}).lean();
    assert.equal(rows.length,1);
    return rows[0];
  }

  await t.test("A owns (X,T); B attempting (X,T) gets 409 and A remains owner",async()=>{
    await resetA();
    assert.equal((await subscribe(baseUrl,authB)).status,409);
    const row=await onlyRow();
    assert.equal(String(row.userId),String(userA._id));
    assert.equal(row.installationId,X);
    assert.equal(row.token,T);
  });

  await t.test("A owns (X,T); B attempting (X,T2) gets 409",async()=>{
    await resetA();
    assert.equal((await subscribe(baseUrl,authB,{installationId:X,token:T2})).status,409);
    const row=await onlyRow();
    assert.equal(String(row.userId),String(userA._id));
    assert.equal(row.token,T);
  });

  await t.test("A owns (X,T); B attempting (Y,T) gets 409 without leaving a claimed Y state",async()=>{
    await resetA();
    assert.equal((await subscribe(baseUrl,authB,{installationId:Y,token:T})).status,409);
    const row=await onlyRow();
    assert.equal(String(row.userId),String(userA._id));
    assert.equal(row.installationId,X);
    assert.equal(await NativePushInstallationState.countDocuments({installationId:Y}),0);
  });

  await t.test("A can re-register (X,T) in the same valid epoch",async()=>{
    await resetA();
    assert.equal((await subscribe(baseUrl,authA)).status,200);
    const row=await onlyRow();
    assert.equal(String(row.userId),String(userA._id));
    assert.equal(row.token,T);
  });

  await t.test("A can refresh (X,T) to (X,T2) within a valid epoch",async()=>{
    await resetA();
    assert.equal((await subscribe(baseUrl,authA,{installationId:X,token:T2})).status,200);
    const row=await onlyRow();
    assert.equal(String(row.userId),String(userA._id));
    assert.equal(row.installationId,X);
    assert.equal(row.token,T2);
    assert.equal(await NativePushToken.countDocuments({token:T}),0);
  });

  await t.test("B cannot revoke A installation or advance its epoch",async()=>{
    await resetA();
    assert.equal((await unsubscribe(baseUrl,authB)).status,409);
    const state=await NativePushInstallationState.findOne({installationId:X}).lean();
    assert.equal(String(state.userId),String(userA._id));
    assert.equal(state.currentEpoch,1);
    assert.equal(state.active,true);
    await onlyRow();
  });

  await t.test("concurrent duplicate claim yields one owner and one 409 with no silent transfer",async()=>{
    await Promise.all([NativePushToken.deleteMany({}),NativePushInstallationState.deleteMany({})]);
    const [a,b]=await Promise.all([
      subscribe(baseUrl,authA,{installationId:X,token:T}),
      subscribe(baseUrl,authB,{installationId:X,token:T2})
    ]);
    assert.deepEqual([a.status,b.status].sort(),[200,409]);
    const row=await onlyRow();
    const owner=String(row.userId);
    const loserAuth=owner===String(userA._id)?authB:authA;
    assert.equal((await subscribe(baseUrl,loserAuth,{installationId:X,token:row.token,lifecycleEpoch:1})).status,409);
    const after=await onlyRow();
    assert.equal(String(after.userId),owner);
  });
});
