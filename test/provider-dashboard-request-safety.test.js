import test from "node:test";
import assert from "node:assert/strict";
import{createLatestRequestManager,isAbortError,rowsForSelectedDate}from"../provider-app/src/requestLifecycle.js";

function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej});
  return {promise,resolve,reject};
}

async function applyWhenCurrent(manager,request,work,state){
  try{
    const value=await work;
    if(manager.isCurrent(request.id))state.data=value;
  }catch(error){
    if(manager.isCurrent(request.id)&&!isAbortError(error))state.error=error.message;
  }
}

test("latest request wins when an older response resolves last",async()=>{
  const manager=createLatestRequestManager();
  const state={data:null,error:""};
  const a=deferred();
  const requestA=manager.start();
  const runA=applyWhenCurrent(manager,requestA,a.promise,state);
  const b=deferred();
  const requestB=manager.start();
  const runB=applyWhenCurrent(manager,requestB,b.promise,state);

  b.resolve("B");
  await runB;
  a.resolve("A");
  await runA;

  assert.equal(state.data,"B");
});

test("stale failure cannot replace a newer success",async()=>{
  const manager=createLatestRequestManager();
  const state={data:null,error:""};
  const a=deferred();
  const requestA=manager.start();
  const runA=applyWhenCurrent(manager,requestA,a.promise,state);
  const b=deferred();
  const requestB=manager.start();
  const runB=applyWhenCurrent(manager,requestB,b.promise,state);

  b.resolve("B");
  await runB;
  a.reject(new Error("old failure"));
  await runA;

  assert.equal(state.data,"B");
  assert.equal(state.error,"");
});

test("starting a newer request aborts the previous request",()=>{
  const manager=createLatestRequestManager();
  const first=manager.start();
  assert.equal(first.signal.aborted,false);
  manager.start();
  assert.equal(first.signal.aborted,true);
});

test("aborted request is not treated as a user-facing error",()=>{
  const error=new Error("aborted");
  error.name="AbortError";
  assert.equal(isAbortError(error),true);
  assert.equal(isAbortError(new Error("network")),false);
});

test("date-scoped rows are hidden until they match the selected date",()=>{
  const rows=[{id:"day-a"}];
  assert.deepEqual(rowsForSelectedDate(rows,"2026-10-10","2026-10-11"),[]);
  assert.deepEqual(rowsForSelectedDate(rows,"2026-10-10","2026-10-10"),rows);
});

test("cancel invalidates the current generation",()=>{
  const manager=createLatestRequestManager();
  const current=manager.start();
  manager.cancel();
  assert.equal(manager.isCurrent(current.id),false);
  assert.equal(current.signal.aborted,true);
});
