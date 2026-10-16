import { cleanupFixtures, requireFixture, connectFixture } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import router from "../src/routes/push.js";
import authRouter from "../src/routes/auth.js";
import User from "../src/models/User.js";
import NativePushToken from "../src/models/NativePushToken.js";
import NativePushLifecycle from "../src/models/NativePushLifecycle.js";
import { NATIVE_PUSH_CONTEXT as context } from "../shared/nativePushContext.js";
import { sendNativePushToUser } from "../src/services/nativeFcm.js";

requireFixture();
test.after(cleanupFixtures);

function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}

test("MongoDB preserves Android token metadata, unique ownership, lifecycle fencing, refresh, revocation and account deletion cleanup",{},async()=>{
  const previous={secret:process.env.JWT_SECRET,enabled:process.env.FCM_ENABLED};
  process.env.JWT_SECRET="isolated-android-fcm-integration-test-secret";
  process.env.FCM_ENABLED="true";
  await connectFixture();
  let server;
  const originalLifecycleUpdate=NativePushLifecycle.findOneAndUpdate;
  try{
    await Promise.all([NativePushToken.init(),NativePushLifecycle.init()]);
    const [a,b,provider,deletedCustomer]=await User.create([{name:"A",role:"customer"},{name:"B",role:"customer"},{name:"P",role:"provider"},{name:"Delete Me",role:"customer"}]);
    const app=express();app.use(express.json());app.use("/auth",authRouter);app.use(router);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    async function post(path,user,body){
      const response=await fetch(`http://127.0.0.1:${server.address().port}/${path}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt.sign({sub:String(user._id),ver:0},process.env.JWT_SECRET)}`},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    }
    const registration={...context,token:"android-fcm-integration-token",installationId:"installation_customer_123",lifecycleGeneration:10};
    assert.equal((await post("native-subscribe",provider,registration)).status,403);
    assert.equal((await post("native-subscribe",a,registration)).status,200);
    assert.equal((await post("native-subscribe",a,registration)).status,200);
    let stored=await NativePushToken.findOne({userId:a._id}).lean();
    for(const [key,value] of Object.entries(context))assert.equal(stored[key],value);
    assert.equal(stored.token,registration.token);assert.equal(stored.installationId,registration.installationId);
    assert.equal(await NativePushToken.countDocuments(),1);
    assert.equal((await post("native-subscribe",b,{...registration,token:"another-customer-private-token"})).status,409);
    assert.equal((await post("native-subscribe",b,{...registration,installationId:"other_installation_456"})).status,409);
    await post("native-unsubscribe",b,{installationId:registration.installationId,lifecycleGeneration:11});
    assert.equal(await NativePushToken.countDocuments({userId:a._id}),1);
    const refreshed={...registration,token:"refreshed-android-fcm-private-token",lifecycleGeneration:11};
    assert.equal((await post("native-subscribe",a,refreshed)).status,200);
    stored=await NativePushToken.findOne({userId:a._id});assert.equal(stored.token,refreshed.token);
    await NativePushToken.create({userId:a._id,token:"legacy-ios-apns-private-token",platform:"ios",installationId:"legacy_ios_installation"});
    const delivered=[];
    const result=await sendNativePushToUser(a._id,{}, {messaging:()=>({send:async message=>delivered.push(message.token)}),log:()=>{}});
    assert.equal(result.sent,1);assert.deepEqual(delivered,[refreshed.token]);

    await post("native-unsubscribe",a,{installationId:registration.installationId,lifecycleGeneration:12});
    assert.equal(await NativePushToken.countDocuments({userId:a._id,installationId:registration.installationId}),0);
    const reachedFenceWrite=deferred(),releaseOldSubscribe=deferred();
    let delayOld=true;
    NativePushLifecycle.findOneAndUpdate=function(filter,update,options){
      if(delayOld&&update?.$set?.state==="active"&&update?.$set?.generation===13){
        delayOld=false;
        return (async()=>{reachedFenceWrite.resolve();await releaseOldSubscribe.promise;return originalLifecycleUpdate.call(this,filter,update,options);})();
      }
      return originalLifecycleUpdate.call(this,filter,update,options);
    };
    const delayedOld=post("native-subscribe",a,{...registration,token:"stale-old-subscribe-private-token",lifecycleGeneration:13});
    await reachedFenceWrite.promise;
    const revoke=await post("native-unsubscribe",a,{installationId:registration.installationId,lifecycleGeneration:14});
    assert.equal(revoke.status,200);
    releaseOldSubscribe.resolve();
    const stale=await delayedOld;
    assert.equal(stale.status,409);
    assert.doesNotMatch(JSON.stringify(stale.body),/stale-old-subscribe-private-token/);
    assert.equal(await NativePushToken.countDocuments({userId:a._id,installationId:registration.installationId}),0);
    const fence=await NativePushLifecycle.findOne({userId:a._id,appId:context.appId,installationId:registration.installationId}).lean();
    assert.equal(fence.generation,14);assert.equal(fence.state,"revoked");

    const deletionInstallation="account_delete_installation_456";
    await NativePushToken.create({...context,userId:deletedCustomer._id,token:"account-delete-fcm-private-token",installationId:deletionInstallation});
    await NativePushLifecycle.create({userId:deletedCustomer._id,appId:context.appId,installationId:deletionInstallation,generation:5,state:"active"});
    assert.equal(await NativePushToken.countDocuments({userId:deletedCustomer._id}),1);
    assert.equal(await NativePushLifecycle.countDocuments({userId:deletedCustomer._id}),1);
    const accountDeletion=await fetch(`http://127.0.0.1:${server.address().port}/auth/account`,{
      method:"DELETE",
      headers:{Authorization:`Bearer ${jwt.sign({sub:String(deletedCustomer._id),ver:0},process.env.JWT_SECRET)}`}
    });
    assert.equal(accountDeletion.status,200);
    assert.equal(await NativePushToken.countDocuments({userId:deletedCustomer._id}),0);
    assert.equal(await NativePushLifecycle.countDocuments({userId:deletedCustomer._id}),0);

    process.env.FCM_ENABLED="false";
    const disabledRevoke=await post("native-unsubscribe",a,{installationId:registration.installationId,lifecycleGeneration:15});
    assert.equal(disabledRevoke.status,200);
  }finally{
    NativePushLifecycle.findOneAndUpdate=originalLifecycleUpdate;
    if(server)await new Promise(resolve=>server.close(resolve));
    for(const [name,value] of [["JWT_SECRET",previous.secret],["FCM_ENABLED",previous.enabled]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
