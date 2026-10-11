import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import NativePushInstallationState from "../src/models/NativePushInstallationState.js";
import { NATIVE_PUSH_APP_ID } from "../src/models/NativePushToken.js";
import {
  initializeNativePushLifecycleIndexes,
  verifyNativePushLifecycleIndexes
} from "../src/config/db.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

function namespaceMissing(error){return error?.code===26||error?.codeName==="NamespaceNotFound";}

test("production lifecycle index readiness path creates and verifies the unique fence index",{skip:!uri},async()=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable MongoDB is allowed");
  await mongoose.connect(uri,{dbName:"seago_native_index_"+crypto.randomUUID().replaceAll("-","")});
  try{
    await NativePushInstallationState.collection.drop().catch(error=>{
      if(!namespaceMissing(error))throw error;
    });

    await initializeNativePushLifecycleIndexes();
    const critical=await verifyNativePushLifecycleIndexes();
    assert.equal(critical.unique,true);
    assert.deepEqual(critical.key,{appId:1,installationId:1});

    const userId=new mongoose.Types.ObjectId();
    const document={
      userId,
      installationId:"startup-index-concurrent-tombstone",
      appId:NATIVE_PUSH_APP_ID,
      currentEpoch:2,
      active:false,
      revokedAt:new Date()
    };
    const results=await Promise.allSettled([
      NativePushInstallationState.create(document),
      NativePushInstallationState.create({...document,userId:new mongoose.Types.ObjectId()})
    ]);
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
    const rejected=results.find(result=>result.status==="rejected");
    assert.ok(rejected);
    assert.equal(rejected.reason?.code,11000);
    assert.equal(await NativePushInstallationState.countDocuments({
      appId:NATIVE_PUSH_APP_ID,
      installationId:document.installationId
    }),1);
  }finally{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
