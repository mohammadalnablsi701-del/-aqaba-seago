import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken, { NATIVE_PUSH_APP_ID } from "../src/models/NativePushToken.js";

const A="507f1f77bcf86cd799439011";
const B="507f1f77bcf86cd799439013";
const X="installation_A_1234567890";
const Y="installation_B_1234567890";
const T="fcm-token-A-abcdefghijklmnopqrstuvwxyz-0123456789";
const T2="fcm-token-B-abcdefghijklmnopqrstuvwxyz-0123456789";

function authToken(id){return jwt.sign({sub:id,ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}

async function startApp(){
  const app=express();
  app.use(express.json());
  app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}

async function subscribe(baseUrl,userId,{installationId=X,token=T}={}){
  const response=await fetch(baseUrl+"/api/push/native-subscribe",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${authToken(userId)}`},
    body:JSON.stringify({token,platform:"android",installationId})
  });
  return {status:response.status,body:await response.json()};
}

function duplicateKey(){const error=new Error("duplicate key");error.code=11000;return error;}
function same(value,left){return String(left)===String(value);}

function makeStore(seed=[],{barrierInserts=0}={}){
  const rows=seed.map((row,index)=>({_id:`row-${index+1}`,appId:NATIVE_PUSH_APP_ID,platform:"android",provider:"fcm",...row}));
  let arrivals=0;
  let releaseBarrier;
  const barrier=barrierInserts?new Promise(resolve=>{releaseBarrier=resolve;}):null;

  function matches(row,filter){
    return Object.entries(filter).every(([key,value])=>same(value,row[key]));
  }
  function ensureUnique(candidate,exceptId){
    const conflict=rows.find(row=>row._id!==exceptId&&(
      row.token===candidate.token||
      (row.appId===candidate.appId&&row.installationId===candidate.installationId)
    ));
    if(conflict)throw duplicateKey();
  }

  async function findOneAndUpdate(filter,update,options){
    const existing=rows.find(row=>matches(row,filter));
    if(existing){
      const candidate={...existing,...update.$set};
      ensureUnique(candidate,existing._id);
      Object.assign(existing,candidate);
      return {...existing};
    }
    if(!options?.upsert)return null;
    if(barrier){
      arrivals++;
      if(arrivals===barrierInserts)releaseBarrier();
      await barrier;
    }
    const candidate={_id:`row-${rows.length+1}`,...update.$set};
    ensureUnique(candidate,null);
    rows.push(candidate);
    return {...candidate};
  }

  return {rows,findOneAndUpdate};
}

async function withHarness(store,run){
  const oldSecret=process.env.JWT_SECRET;
  const oldFindById=User.findById;
  const oldFindOneAndUpdate=NativePushToken.findOneAndUpdate;
  process.env.JWT_SECRET="native-push-p1-ownership-test-secret";
  const users=new Map([
    [A,{_id:A,role:"customer",isActive:true,authVersion:0}],
    [B,{_id:B,role:"customer",isActive:true,authVersion:0}]
  ]);
  User.findById=id=>({select:async()=>users.get(String(id))||null});
  NativePushToken.findOneAndUpdate=store.findOneAndUpdate;
  let server;
  try{
    const started=await startApp();
    server=started.server;
    await run(started.baseUrl,store.rows);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    User.findById=oldFindById;
    NativePushToken.findOneAndUpdate=oldFindOneAndUpdate;
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  }
}

function ownedByA(){return makeStore([{userId:A,installationId:X,token:T}]);}

test("P1 ownership: B cannot claim A's same installation and same token",async()=>withHarness(ownedByA(),async(baseUrl,rows)=>{
  const result=await subscribe(baseUrl,B);
  assert.equal(result.status,409);
  assert.equal(rows.length,1);
  assert.equal(rows[0].userId,A);
  assert.equal(rows[0].token,T);
}));

test("P1 ownership: B cannot claim A's installation with a different token",async()=>withHarness(ownedByA(),async(baseUrl,rows)=>{
  const result=await subscribe(baseUrl,B,{installationId:X,token:T2});
  assert.equal(result.status,409);
  assert.equal(rows.length,1);
  assert.equal(rows[0].userId,A);
  assert.equal(rows[0].token,T);
}));

test("P1 ownership: B cannot claim A's token from a different installation",async()=>withHarness(ownedByA(),async(baseUrl,rows)=>{
  const result=await subscribe(baseUrl,B,{installationId:Y,token:T});
  assert.equal(result.status,409);
  assert.equal(rows.length,1);
  assert.equal(rows[0].userId,A);
  assert.equal(rows[0].installationId,X);
}));

test("P1 ownership: A may re-register the same installation and token",async()=>withHarness(ownedByA(),async(baseUrl,rows)=>{
  const result=await subscribe(baseUrl,A);
  assert.equal(result.status,200);
  assert.equal(rows.length,1);
  assert.equal(rows[0].userId,A);
  assert.equal(rows[0].token,T);
}));

test("P1 ownership: A may atomically refresh the token for the same installation",async()=>withHarness(ownedByA(),async(baseUrl,rows)=>{
  const result=await subscribe(baseUrl,A,{installationId:X,token:T2});
  assert.equal(result.status,200);
  assert.equal(rows.length,1);
  assert.equal(rows[0].userId,A);
  assert.equal(rows[0].installationId,X);
  assert.equal(rows[0].token,T2);
  assert.equal(rows.some(row=>row.token===T),false);
}));

test("P1 ownership: concurrent duplicate race produces one owner and one 409 without reassignment",async()=>{
  const store=makeStore([],{barrierInserts:2});
  await withHarness(store,async(baseUrl,rows)=>{
    const [a,b]=await Promise.all([
      subscribe(baseUrl,A,{installationId:X,token:T}),
      subscribe(baseUrl,B,{installationId:X,token:T2})
    ]);
    assert.deepEqual([a.status,b.status].sort(),[200,409]);
    assert.equal(rows.length,1);
    const originalOwner=rows[0].userId;
    const loser=originalOwner===A?B:A;
    const retry=await subscribe(baseUrl,loser,{installationId:X,token:rows[0].token});
    assert.equal(retry.status,409);
    assert.equal(rows.length,1);
    assert.equal(rows[0].userId,originalOwner);
  });
});

test("P1 ownership behavioral store mirrors the schema uniqueness relied on by the route",()=>{
  assert.equal(NativePushToken.schema.path("token").options.unique,true);
  const indexes=NativePushToken.schema.indexes();
  assert.ok(indexes.some(([fields,options])=>fields.appId===1&&fields.installationId===1&&options.unique===true));
});
