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

test("missing or wrong critical unique index fails verification",async()=>{
  const missingUnique={collection:{indexes:async()=>[
    {name:"_id_",key:{_id:1}},
    {name:"appId_1_installationId_1",key:{appId:1,installationId:1}}
  ]}};
  await assert.rejects(
    verifyNativePushLifecycleIndexes({model:missingUnique}),
    /index verification failed/
  );

  const wrongKeys={collection:{indexes:async()=>[
    {name:"wrong",key:{appId:1,userId:1},unique:true}
  ]}};
  await assert.rejects(
    verifyNativePushLifecycleIndexes({model:wrongKeys}),
    /index verification failed/
  );
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
