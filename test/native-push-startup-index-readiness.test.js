import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapServer } from "../src/server.js";
import {
  initializeNativePushLifecycleIndexes,
  verifyNativePushLifecycleIndexes
} from "../src/config/db.js";

function deferred(){
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}

function startupHarness(overrides={}){
  let listenCalls=0;
  const events=[];
  const server={close(){}};
  const app={get(){}};
  const options={
    env:{
      MONGODB_URI:"mongodb://startup-gate.invalid/seago",
      JWT_SECRET:"startup-index-test-secret",
      NODE_ENV:"test"
    },
    connect:async()=>{events.push("db");},
    initializeLifecycleIndexes:async()=>{events.push("index");},
    appFactory:()=>app,
    expireHolds:async()=>{events.push("holds");},
    reminders:async()=>{},
    listen:(_app,_port,onListening)=>{
      listenCalls++;
      events.push("listen");
      onListening?.();
      return server;
    },
    scheduleJobs:false,
    installSignals:false,
    logger:{log(){},error(){}},
    ...overrides
  };
  return {options,events,get listenCalls(){return listenCalls;}};
}

function modelWithIndexes(indexes){
  return {collection:{indexes:async()=>indexes}};
}

test("startup waits for lifecycle index initialization before listening",async()=>{
  const gate=deferred();
  const harness=startupHarness({
    initializeLifecycleIndexes:async()=>{
      harness.events.push("index-start");
      await gate.promise;
      harness.events.push("index-ready");
    }
  });
  const starting=bootstrapServer(harness.options);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.listenCalls,0);
  assert.deepEqual(harness.events,["db","index-start"]);
  gate.resolve();
  await starting;
  assert.equal(harness.listenCalls,1);
  assert.deepEqual(harness.events,["db","index-start","index-ready","holds","listen"]);
});

test("index initialization failure prevents listener startup",async()=>{
  const harness=startupHarness({
    initializeLifecycleIndexes:async()=>{
      const error=new Error("Native push lifecycle index initialization failed");
      error.code="NATIVE_PUSH_LIFECYCLE_INDEX_NOT_READY";
      throw error;
    }
  });
  await assert.rejects(bootstrapServer(harness.options),/index initialization failed/);
  assert.equal(harness.listenCalls,0);
});

test("critical lifecycle index verification accepts only exact ordered unique pair",async()=>{
  const accepted={name:"any-name",key:{appId:1,installationId:1},unique:true};
  const verified=await verifyNativePushLifecycleIndexes({model:modelWithIndexes([accepted])});
  assert.equal(verified,accepted);
  assert.deepEqual(Object.entries(verified.key),[["appId",1],["installationId",1]]);

  const rejected=[
    ["missing index",[]],
    ["non-unique",[{key:{appId:1,installationId:1},unique:false}]],
    ["only appId",[{key:{appId:1},unique:true}]],
    ["only installationId",[{key:{installationId:1},unique:true}]],
    ["extra field",[{key:{appId:1,installationId:1,userId:1},unique:true}]],
    ["wrong direction",[{key:{appId:-1,installationId:1},unique:true}]],
    ["reversed order",[{key:{installationId:1,appId:1},unique:true}]],
    ["malformed metadata",[{key:null,unique:true}]]
  ];
  for(const [label,indexes] of rejected){
    await assert.rejects(
      verifyNativePushLifecycleIndexes({model:modelWithIndexes(indexes)}),
      /index verification failed/,
      label
    );
  }
});

test("reversed critical index fails closed before HTTP listener startup",async()=>{
  const reversed=modelWithIndexes([
    {name:"installationId_1_appId_1",key:{installationId:1,appId:1},unique:true}
  ]);
  const harness=startupHarness({
    initializeLifecycleIndexes:()=>verifyNativePushLifecycleIndexes({model:reversed})
  });
  await assert.rejects(bootstrapServer(harness.options),/index verification failed/);
  assert.equal(harness.listenCalls,0);
  assert.deepEqual(harness.events,["db"]);
});

test("explicit index init is awaited and correct metadata allows startup",async()=>{
  const gate=deferred();
  const calls=[];
  const model={
    init:async()=>{calls.push("init-start");await gate.promise;calls.push("init-ready");},
    createIndexes:async()=>{calls.push("create-indexes");},
    collection:{indexes:async()=>[
      {name:"generated-name-is-not-authority",key:{appId:1,installationId:1},unique:true}
    ]}
  };
  const init=initializeNativePushLifecycleIndexes({model});
  await Promise.resolve();
  assert.deepEqual(calls,["init-start"]);
  gate.resolve();
  await init;
  assert.deepEqual(calls,["init-start","init-ready","create-indexes"]);

  const harness=startupHarness({
    initializeLifecycleIndexes:()=>initializeNativePushLifecycleIndexes({model})
  });
  await bootstrapServer(harness.options);
  assert.equal(harness.listenCalls,1);
});

test("model index creation failure is fail-closed",async()=>{
  const model={
    init:async()=>{},
    createIndexes:async()=>{throw new Error("driver failure with sensitive details");},
    collection:{indexes:async()=>[]}
  };
  await assert.rejects(
    initializeNativePushLifecycleIndexes({model}),
    error=>error?.code==="NATIVE_PUSH_LIFECYCLE_INDEX_NOT_READY"&&error.message==="Native push lifecycle index initialization failed"
  );
});
