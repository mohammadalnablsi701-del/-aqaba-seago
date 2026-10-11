import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken, { NATIVE_PUSH_APP_ID } from "../src/models/NativePushToken.js";
import NativePushInstallationState from "../src/models/NativePushInstallationState.js";

const A="507f1f77bcf86cd799439011";
const B="507f1f77bcf86cd799439013";
const X="installation_A_1234567890";
const T="fcm-token-A-abcdefghijklmnopqrstuvwxyz-0123456789";
const T2="fcm-token-B-abcdefghijklmnopqrstuvwxyz-0123456789";

function authToken(id){return jwt.sign({sub:id,ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}
function same(left,right){return String(left)===String(right);}
function matches(row,filter){return Object.entries(filter).every(([key,value])=>same(row[key],value));}
function applyUpdate(row,update){
  if(update.$set)Object.assign(row,update.$set);
  if(update.$inc)for(const [key,value] of Object.entries(update.$inc))row[key]=Number(row[key]||0)+Number(value);
  if(update.$unset)for(const key of Object.keys(update.$unset))delete row[key];
  return row;
}
function duplicate(){const error=new Error("duplicate key");error.code=11000;return error;}

function makeStore(){
  const states=[];
  const tokens=[];
  let next=1;
  const stateApi={
    findOne:async filter=>states.find(row=>matches(row,filter))||null,
    findOneAndUpdate:async(filter,update,options={})=>{
      let row=states.find(item=>matches(item,filter));
      if(!row&&options.upsert){
        const candidate={_id:`state-${next++}`,...filter};
        if(states.some(item=>item.appId===candidate.appId&&item.installationId===candidate.installationId))throw duplicate();
        row=applyUpdate(candidate,update);
        states.push(row);
      }else if(row)applyUpdate(row,update);
      return row?{...row}:null;
    },
    create:async docs=>{
      const output=[];
      for(const doc of docs){
        if(states.some(item=>item.appId===doc.appId&&item.installationId===doc.installationId))throw duplicate();
        const row={_id:`state-${next++}`,...doc};states.push(row);output.push({...row});
      }
      return output;
    }
  };
  const tokenApi={
    findOne:async filter=>tokens.find(row=>matches(row,filter))||null,
    findOneAndUpdate:async(filter,update,options={})=>{
      let row=tokens.find(item=>matches(item,filter));
      if(!row&&options.upsert){
        const candidate={_id:`token-${next++}`,...filter,...(update.$set||{})};
        if(tokens.some(item=>item.token===candidate.token||(item.appId===candidate.appId&&item.installationId===candidate.installationId)))throw duplicate();
        row=candidate;tokens.push(row);
      }else if(row){
        const candidate=applyUpdate({...row},update);
        if(tokens.some(item=>item._id!==row._id&&(item.token===candidate.token||(item.appId===candidate.appId&&item.installationId===candidate.installationId))))throw duplicate();
        Object.assign(row,candidate);
      }
      return row?{...row}:null;
    },
    deleteMany:async filter=>{
      let count=0;
      for(let index=tokens.length-1;index>=0;index--){if(matches(tokens[index],filter)){tokens.splice(index,1);count++;}}
      return {deletedCount:count};
    }
  };
  return {states,tokens,stateApi,tokenApi};
}

async function startApp(){
  const app=express();app.use(express.json());app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
async function post(baseUrl,path,userId,body){
  const response=await fetch(baseUrl+path,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${authToken(userId)}`},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
const subscribe=(baseUrl,userId,{token=T,lifecycleEpoch=1}={})=>post(baseUrl,"/api/push/native-subscribe",userId,{token,platform:"android",installationId:X,lifecycleEpoch});
const revoke=(baseUrl,userId,{lifecycleEpoch=1}={})=>post(baseUrl,"/api/push/native-unsubscribe",userId,{installationId:X,lifecycleEpoch});

async function withHarness(run){
  const store=makeStore();
  const oldSecret=process.env.JWT_SECRET;
  const oldFindById=User.findById;
  const oldStartSession=mongoose.startSession;
  const oldStateFind=NativePushInstallationState.findOne;
  const oldStateUpdate=NativePushInstallationState.findOneAndUpdate;
  const oldStateCreate=NativePushInstallationState.create;
  const oldTokenFind=NativePushToken.findOne;
  const oldTokenUpdate=NativePushToken.findOneAndUpdate;
  const oldTokenDelete=NativePushToken.deleteMany;
  process.env.JWT_SECRET="native-push-p1-ownership-test-secret";
  const users=new Map([[A,{_id:A,role:"customer",isActive:true,authVersion:0}],[B,{_id:B,role:"customer",isActive:true,authVersion:0}]]);
  User.findById=id=>({select:async()=>users.get(String(id))||null});
  mongoose.startSession=async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}});
  NativePushInstallationState.findOne=store.stateApi.findOne;
  NativePushInstallationState.findOneAndUpdate=store.stateApi.findOneAndUpdate;
  NativePushInstallationState.create=store.stateApi.create;
  NativePushToken.findOne=store.tokenApi.findOne;
  NativePushToken.findOneAndUpdate=store.tokenApi.findOneAndUpdate;
  NativePushToken.deleteMany=store.tokenApi.deleteMany;
  let server;
  try{
    const started=await startApp();server=started.server;
    await run(started.baseUrl,store);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    User.findById=oldFindById;mongoose.startSession=oldStartSession;
    NativePushInstallationState.findOne=oldStateFind;NativePushInstallationState.findOneAndUpdate=oldStateUpdate;NativePushInstallationState.create=oldStateCreate;
    NativePushToken.findOne=oldTokenFind;NativePushToken.findOneAndUpdate=oldTokenUpdate;NativePushToken.deleteMany=oldTokenDelete;
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  }
}

test("P1 ownership: B cannot claim or revoke A installation",async()=>withHarness(async(baseUrl,store)=>{
  assert.equal((await subscribe(baseUrl,A)).status,200);
  assert.equal((await subscribe(baseUrl,B,{token:T2})).status,409);
  assert.equal((await revoke(baseUrl,B)).status,409);
  assert.equal(store.tokens.length,1);
  assert.equal(store.tokens[0].userId,A);
  assert.equal(store.states.length,1);
  assert.equal(store.states[0].userId,A);
  assert.equal(store.states[0].currentEpoch,1);
}));

test("P1 ownership: A can refresh token in the same epoch",async()=>withHarness(async(baseUrl,store)=>{
  assert.equal((await subscribe(baseUrl,A)).status,200);
  assert.equal((await subscribe(baseUrl,A,{token:T2})).status,200);
  assert.equal(store.tokens.length,1);
  assert.equal(store.tokens[0].token,T2);
  assert.equal(store.states[0].currentEpoch,1);
}));

test("P1 lifecycle: revoke advances once and stale subscribe fails closed",async()=>withHarness(async(baseUrl,store)=>{
  assert.equal((await subscribe(baseUrl,A)).status,200);
  const fenced=await revoke(baseUrl,A);
  assert.equal(fenced.status,200);
  assert.equal(fenced.body.lifecycleEpoch,2);
  assert.equal(store.tokens.length,0);
  assert.equal(store.states[0].currentEpoch,2);
  assert.equal(store.states[0].active,false);
  assert.equal((await subscribe(baseUrl,A,{token:T2,lifecycleEpoch:1})).status,410);
  assert.equal(store.tokens.length,0);
}));

test("P1 schema keeps token uniqueness and durable installation-state uniqueness",()=>{
  assert.equal(NativePushToken.schema.path("token").options.unique,true);
  assert.ok(NativePushToken.schema.indexes().some(([fields,options])=>fields.appId===1&&fields.installationId===1&&options.unique===true));
  assert.ok(NativePushInstallationState.schema.indexes().some(([fields,options])=>fields.appId===1&&fields.installationId===1&&options.unique===true));
});
