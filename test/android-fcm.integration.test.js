import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import router from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken from "../src/models/NativePushToken.js";
import { NATIVE_PUSH_CONTEXT as context } from "../shared/nativePushContext.js";
import { sendNativePushToUser } from "../src/services/nativeFcm.js";

test("MongoDB preserves Android token metadata, unique ownership, refresh and revocation",{skip:!process.env.SEAGO_TEST_MONGODB_URI},async()=>{
  const previous={secret:process.env.JWT_SECRET,enabled:process.env.FCM_ENABLED};
  process.env.JWT_SECRET="isolated-android-fcm-integration-test-secret";
  process.env.FCM_ENABLED="true";
  await mongoose.connect(process.env.SEAGO_TEST_MONGODB_URI,{dbName:"aqaba-seago-test-android-fcm"});
  let server;
  try{
    await mongoose.connection.dropDatabase();
    await NativePushToken.init();
    const [a,b,provider]=await User.create([{name:"A",role:"customer"},{name:"B",role:"customer"},{name:"P",role:"provider"}]);
    const app=express();app.use(express.json());app.use(router);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    async function post(path,user,body){
      const response=await fetch(`http://127.0.0.1:${server.address().port}/${path}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt.sign({sub:String(user._id),ver:0},process.env.JWT_SECRET)}`},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    }
    const registration={...context,token:"android-fcm-integration-token",installationId:"installation_customer_123"};
    assert.equal((await post("native-subscribe",provider,registration)).status,403);
    assert.equal((await post("native-subscribe",a,registration)).status,200);
    assert.equal((await post("native-subscribe",a,registration)).status,200);
    let stored=await NativePushToken.findOne({userId:a._id}).lean();
    for(const [key,value] of Object.entries(registration))assert.equal(stored[key],value);
    assert.equal(await NativePushToken.countDocuments(),1);
    assert.equal((await post("native-subscribe",b,{...registration,token:"another-customer-private-token"})).status,409);
    assert.equal((await post("native-subscribe",b,{...registration,installationId:"other_installation_456"})).status,409);
    await post("native-unsubscribe",b,{installationId:registration.installationId});
    assert.equal(await NativePushToken.countDocuments({userId:a._id}),1);
    const refreshed={...registration,token:"refreshed-android-fcm-private-token"};
    assert.equal((await post("native-subscribe",a,refreshed)).status,200);
    stored=await NativePushToken.findOne({userId:a._id});assert.equal(stored.token,refreshed.token);
    await NativePushToken.create({userId:a._id,token:"legacy-ios-apns-private-token",platform:"ios",installationId:"legacy_ios_installation"});
    const delivered=[];
    const result=await sendNativePushToUser(a._id,{}, {messaging:()=>({send:async message=>delivered.push(message.token)}),log:()=>{}});
    assert.equal(result.sent,1);assert.deepEqual(delivered,[refreshed.token]);
    process.env.FCM_ENABLED="false";
    await post("native-unsubscribe",a,{installationId:registration.installationId});
    assert.equal(await NativePushToken.countDocuments({token:refreshed.token}),0);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.connection.dropDatabase();await mongoose.disconnect();
    for(const [name,value] of [["JWT_SECRET",previous.secret],["FCM_ENABLED",previous.enabled]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
