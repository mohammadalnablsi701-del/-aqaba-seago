import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import notificationRouter from "../src/routes/notifications.js";
import User from "../src/models/User.js";
import InAppNotification from "../src/models/InAppNotification.js";

const A="507f1f77bcf86cd799439011";
const B="507f191e810c19729de860ea";
const N_A="507f1f77bcf86cd799439022";
const N_B="507f191e810c19729de860bb";

function startApp(){
  const app=express();
  app.use(express.json());
  app.use("/api/notifications",notificationRouter);
  const server=app.listen(0,"127.0.0.1");
  return new Promise((resolve,reject)=>{
    server.once("listening",()=>resolve({server,baseUrl:`http://127.0.0.1:${server.address().port}`}));
    server.once("error",reject);
  });
}

function token(userId){return jwt.sign({sub:userId,role:"customer",ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}

function fakeQuery(result){
  return {
    select(){return this;},
    sort(){return this;},
    limit(){return this;},
    lean:async()=>result
  };
}

async function request(baseUrl,path,{method="GET",token:authToken}={}){
  const response=await fetch(baseUrl+path,{method,headers:authToken?{authorization:`Bearer ${authToken}`}:{}});
  return {response,body:await response.json()};
}

test("customer notification read/list operations are authenticated, owner-scoped and DTO-safe",async()=>{
  const originalSecret=process.env.JWT_SECRET;
  const originalUserFindById=User.findById;
  const originalFind=InAppNotification.find;
  const originalCount=InAppNotification.countDocuments;
  const originalFindOneAndUpdate=InAppNotification.findOneAndUpdate;
  const originalUpdateMany=InAppNotification.updateMany;

  process.env.JWT_SECRET="notification-owner-test-secret-32chars";
  const users=new Map([
    [A,{_id:A,role:"customer",isActive:true,authVersion:0}],
    [B,{_id:B,role:"customer",isActive:true,authVersion:0}]
  ]);
  const rows=new Map([
    [N_A,{_id:N_A,userId:A,type:"booking_confirmed",title:"Booking confirmed",body:"Open SeaGo",readAt:null,createdAt:new Date("2026-10-11T06:00:00Z"),data:{providerMessageId:"hidden"},__v:7}],
    [N_B,{_id:N_B,userId:B,type:"booking_confirmed",title:"Other user",body:"Private",readAt:null,createdAt:new Date("2026-10-11T06:01:00Z"),data:{deviceToken:"hidden-token"},__v:8}]
  ]);

  User.findById=id=>({select:async()=>users.get(String(id))||null});
  InAppNotification.find=query=>fakeQuery([...rows.values()].filter(row=>String(row.userId)===String(query.userId)));
  InAppNotification.countDocuments=async query=>[...rows.values()].filter(row=>String(row.userId)===String(query.userId)&&row.readAt==null).length;
  InAppNotification.findOneAndUpdate=(query,update)=>{
    const row=rows.get(String(query._id));
    if(!row||String(row.userId)!==String(query.userId))return fakeQuery(null);
    row.readAt=update.$set.readAt;
    return fakeQuery(row);
  };
  InAppNotification.updateMany=async query=>{
    let modifiedCount=0;
    for(const row of rows.values()){
      if(String(row.userId)===String(query.userId)&&row.readAt==null){row.readAt=new Date();modifiedCount++;}
    }
    return {modifiedCount};
  };

  let server;
  try{
    const started=await startApp();
    server=started.server;
    const tokenA=token(A);

    const unauth=await request(started.baseUrl,"/api/notifications");
    assert.equal(unauth.response.status,401);

    const list=await request(started.baseUrl,"/api/notifications",{token:tokenA});
    assert.equal(list.response.status,200);
    assert.equal(list.body.items.length,1);
    assert.equal(list.body.items[0]._id,N_A);
    assert.deepEqual(Object.keys(list.body.items[0]).sort(),["_id","body","createdAt","readAt","title","type"].sort());
    assert.equal(JSON.stringify(list.body).includes("hidden"),false);

    const otherUserRead=await request(started.baseUrl,`/api/notifications/${N_B}/read`,{method:"PATCH",token:tokenA});
    assert.equal(otherUserRead.response.status,404);
    assert.equal(rows.get(N_B).readAt,null);

    const ownRead=await request(started.baseUrl,`/api/notifications/${N_A}/read`,{method:"PATCH",token:tokenA});
    assert.equal(ownRead.response.status,200);
    assert.ok(ownRead.body.readAt);
    assert.equal("userId" in ownRead.body,false);
    assert.equal("data" in ownRead.body,false);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    User.findById=originalUserFindById;
    InAppNotification.find=originalFind;
    InAppNotification.countDocuments=originalCount;
    InAppNotification.findOneAndUpdate=originalFindOneAndUpdate;
    InAppNotification.updateMany=originalUpdateMany;
    if(originalSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalSecret;
  }
});
