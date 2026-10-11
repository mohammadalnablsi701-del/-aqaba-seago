import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken, { NATIVE_PUSH_APP_ID } from "../src/models/NativePushToken.js";
import NativePushInstallationState from "../src/models/NativePushInstallationState.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const X="installation_fence_1234567890";
const T="fcm-fence-token-abcdefghijklmnopqrstuvwxyz-0123456789";
const T2="fcm-fence-token-refresh-abcdefghijklmnopqrstuvwxyz-0123456789";

function tokenFor(userId){return jwt.sign({sub:String(userId),ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}

async function startApp(){
  const app=express();
  app.use(express.json());
  app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}

async function post(baseUrl,path,authToken,body){
  const response=await fetch(baseUrl+path,{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${authToken}`},
    body:JSON.stringify(body)
  });
  return {status:response.status,body:await response.json()};
}

const subscribe=(baseUrl,authToken,{token=T,lifecycleEpoch=1,installationId=X}={})=>post(
  baseUrl,"/api/push/native-subscribe",authToken,{token,platform:"android",installationId,lifecycleEpoch}
);
const revoke=(baseUrl,authToken,{lifecycleEpoch=1,installationId=X}={})=>post(
  baseUrl,"/api/push/native-unsubscribe",authToken,{installationId,lifecycleEpoch}
);

test("server-enforced native push lifecycle fence survives races and restart",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable MongoDB is allowed");
  const previousJwt=process.env.JWT_SECRET;
  process.env.JWT_SECRET="native-push-lifecycle-fence-test-secret-at-least-32-chars";
  await mongoose.connect(uri,{dbName:"seago_native_fence_"+crypto.randomUUID().replaceAll("-","")});
  await Promise.all([User,NativePushToken,NativePushInstallationState].map(model=>model.init()));
  const userA=await User.create({name:"Fence A",phone:"+962790004001",role:"customer"});
  const userB=await User.create({name:"Fence B",phone:"+962790004002",role:"customer"});
  const authA=tokenFor(userA._id);
  const authB=tokenFor(userB._id);
  let app=await startApp();

  t.after(async()=>{
    await new Promise(resolve=>app.server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(previousJwt===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousJwt;
  });

  async function reset(){
    await Promise.all([NativePushToken.deleteMany({}),NativePushInstallationState.deleteMany({})]);
  }
  async function seed({epoch=10,active=true,token=T}={}){
    await reset();
    await NativePushInstallationState.create({
      userId:userA._id,installationId:X,appId:NATIVE_PUSH_APP_ID,currentEpoch:epoch,active,
      ...(active?{lastSubscribedAt:new Date()}:{revokedAt:new Date()})
    });
    if(token){
      await NativePushToken.create({userId:userA._id,installationId:X,appId:NATIVE_PUSH_APP_ID,token,platform:"android"});
    }
  }
  async function assertFence(epoch,{active=false,tokenCount=0}={}){
    const state=await NativePushInstallationState.findOne({appId:NATIVE_PUSH_APP_ID,installationId:X}).lean();
    assert.ok(state);
    assert.equal(String(state.userId),String(userA._id));
    assert.equal(state.currentEpoch,epoch);
    assert.equal(state.active,active);
    assert.equal(await NativePushToken.countDocuments({appId:NATIVE_PUSH_APP_ID,installationId:X}),tokenCount);
  }

  await t.test("revoke on an empty installation creates a tombstone before a delayed initial subscribe",async()=>{
    await reset();
    const fenced=await revoke(app.baseUrl,authA,{lifecycleEpoch:1});
    assert.equal(fenced.status,200);
    assert.equal(fenced.body.lifecycleEpoch,2);
    const stale=await subscribe(app.baseUrl,authA,{lifecycleEpoch:1});
    assert.equal(stale.status,410);
    await assertFence(2);
  });

  await t.test("stale subscribe after revoke cannot recreate a binding",async()=>{
    await seed({epoch:10});
    const fenced=await revoke(app.baseUrl,authA,{lifecycleEpoch:10});
    assert.equal(fenced.status,200);
    assert.equal(fenced.body.lifecycleEpoch,11);
    const stale=await subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:10});
    assert.equal(stale.status,410);
    await assertFence(11);
  });

  await t.test("subscribe vs revoke race has a serializable final fence and no token",async()=>{
    for(let attempt=0;attempt<6;attempt++){
      await seed({epoch:10});
      const [registration,fenced]=await Promise.all([
        subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:10}),
        revoke(app.baseUrl,authA,{lifecycleEpoch:10})
      ]);
      assert.equal(fenced.status,200);
      assert.ok([200,410].includes(registration.status));
      await assertFence(11);
    }
  });

  await t.test("old epoch remains stale after application/server restart",async()=>{
    await seed({epoch:10});
    assert.equal((await revoke(app.baseUrl,authA,{lifecycleEpoch:10})).status,200);
    await new Promise(resolve=>app.server.close(resolve));
    app=await startApp();
    const stale=await subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:10});
    assert.equal(stale.status,410);
    await assertFence(11);
  });

  await t.test("same owner may activate the exact new epoch, but the old epoch stays stale",async()=>{
    await seed({epoch:10});
    const fenced=await revoke(app.baseUrl,authA,{lifecycleEpoch:10});
    assert.equal(fenced.body.lifecycleEpoch,11);
    const fresh=await subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:11});
    assert.equal(fresh.status,200);
    assert.equal(fresh.body.lifecycleEpoch,11);
    await assertFence(11,{active:true,tokenCount:1});
    assert.equal((await subscribe(app.baseUrl,authA,{token:T,lifecycleEpoch:10})).status,410);
    await assertFence(11,{active:true,tokenCount:1});
  });

  await t.test("different user cannot claim or revoke another owner's fenced installation",async()=>{
    await seed({epoch:10});
    assert.equal((await subscribe(app.baseUrl,authB,{token:T2,lifecycleEpoch:10})).status,409);
    assert.equal((await revoke(app.baseUrl,authB,{lifecycleEpoch:10})).status,409);
    await assertFence(10,{active:true,tokenCount:1});
  });

  await t.test("different user cannot inherit an installation after A revokes it",async()=>{
    await seed({epoch:10});
    assert.equal((await revoke(app.baseUrl,authA,{lifecycleEpoch:10})).status,200);
    assert.equal((await subscribe(app.baseUrl,authB,{token:T2,lifecycleEpoch:11})).status,409);
    await assertFence(11);
  });

  await t.test("concurrent revokes are idempotent and advance exactly once",async()=>{
    await seed({epoch:10});
    const [left,right]=await Promise.all([
      revoke(app.baseUrl,authA,{lifecycleEpoch:10}),
      revoke(app.baseUrl,authA,{lifecycleEpoch:10})
    ]);
    assert.equal(left.status,200);
    assert.equal(right.status,200);
    assert.equal(left.body.lifecycleEpoch,11);
    assert.equal(right.body.lifecycleEpoch,11);
    await assertFence(11);
  });

  await t.test("token refresh within one valid epoch is safe",async()=>{
    await seed({epoch:10});
    const refreshed=await subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:10});
    assert.equal(refreshed.status,200);
    const rows=await NativePushToken.find({appId:NATIVE_PUSH_APP_ID,installationId:X}).lean();
    assert.equal(rows.length,1);
    assert.equal(rows[0].token,T2);
    await assertFence(10,{active:true,tokenCount:1});
  });

  await t.test("client cannot jump the lifecycle epoch to reclaim or advance state",async()=>{
    await reset();
    assert.equal((await subscribe(app.baseUrl,authA,{lifecycleEpoch:999999})).status,410);
    assert.equal(await NativePushInstallationState.countDocuments({}),0);
    assert.equal(await NativePushToken.countDocuments({}),0);

    await seed({epoch:10});
    assert.equal((await subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:11})).status,410);
    assert.equal((await revoke(app.baseUrl,authA,{lifecycleEpoch:11})).status,410);
    await assertFence(10,{active:true,tokenCount:1});
  });

  await t.test("legacy token ownership migrates on access without silent transfer",async()=>{
    await reset();
    await NativePushToken.create({userId:userA._id,installationId:X,appId:NATIVE_PUSH_APP_ID,token:T,platform:"android"});
    assert.equal((await subscribe(app.baseUrl,authB,{token:T2,lifecycleEpoch:1})).status,409);
    assert.equal(await NativePushInstallationState.countDocuments({}),0);
    const migrated=await subscribe(app.baseUrl,authA,{token:T2,lifecycleEpoch:1});
    assert.equal(migrated.status,200);
    await assertFence(1,{active:true,tokenCount:1});
  });
});
