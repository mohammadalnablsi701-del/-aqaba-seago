import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import { backupDatabase,restoreDatabase,assertRestoreAllowed } from "../src/ops/databaseBackup.js";

const {MongoClient,ObjectId,Decimal128}=mongoose.mongo;
const uri=process.env.SEAGO_TEST_MONGODB_URI;

test("restore guard blocks unsafe production restores",()=>{
  assert.throws(()=>assertRestoreAllowed({
    env:{NODE_ENV:"production",ALLOW_DB_RESTORE:"true",RESTORE_CONFIRM_DATABASE:"restore"},
    targetDatabase:"restore",
    sourceDatabase:"source"
  }),/NODE_ENV=production/);
  assert.throws(()=>assertRestoreAllowed({
    env:{ALLOW_DB_RESTORE:"true",RESTORE_CONFIRM_DATABASE:"source"},
    targetDatabase:"source",
    sourceDatabase:"source"
  }),/must differ/);
});

test("backup and restore preserve BSON values, documents and indexes",{skip:!uri},async()=>{
  const sourceDatabase=`seago_backup_source_${Date.now()}`;
  const targetDatabase=`seago_restore_test_${Date.now()}`;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"seago-backup-"));
  const backupPath=path.join(dir,"backup.json.gz");
  const client=new MongoClient(uri);
  await client.connect();
  try{
    const source=client.db(sourceDatabase);
    await source.collection("bookings").createIndex({bookingRef:1},{unique:true,name:"bookingRef_1"});
    const id=new ObjectId();
    await source.collection("bookings").insertOne({
      _id:id,
      bookingRef:"BK-001",
      createdAt:new Date("2026-10-07T12:00:00.000Z"),
      amount:Decimal128.fromString("19.750"),
      nested:{ok:true}
    });
    await source.collection("empty_collection").insertOne({seed:true});
    await source.collection("empty_collection").deleteMany({});

    const backup=await backupDatabase({uri,databaseName:sourceDatabase,outputPath:backupPath});
    assert.equal(backup.collections,2);
    assert.equal(backup.documents,1);

    const restore=await restoreDatabase({
      uri,
      databaseName:targetDatabase,
      backupPath,
      env:{
        NODE_ENV:"test",
        PUBLIC_LAUNCH:"false",
        ALLOW_DB_RESTORE:"true",
        RESTORE_CONFIRM_DATABASE:targetDatabase
      }
    });
    assert.equal(restore.documents,1);

    const restored=client.db(targetDatabase);
    const doc=await restored.collection("bookings").findOne({_id:id});
    assert.equal(doc.bookingRef,"BK-001");
    assert.equal(doc.createdAt.toISOString(),"2026-10-07T12:00:00.000Z");
    assert.equal(doc.amount.toString(),"19.750");
    assert.deepEqual(doc.nested,{ok:true});
    assert.equal(await restored.collection("empty_collection").countDocuments(),0);
    const indexes=await restored.collection("bookings").indexes();
    assert.ok(indexes.some(index=>index.name==="bookingRef_1"&&index.unique===true));
  }finally{
    await client.db(sourceDatabase).dropDatabase().catch(()=>{});
    await client.db(targetDatabase).dropDatabase().catch(()=>{});
    await client.close();
    await fs.rm(dir,{recursive:true,force:true});
  }
});
