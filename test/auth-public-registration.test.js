import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import authRouter from "../src/routes/auth.js";
import User from "../src/models/User.js";

function startTestApp(){
  const app=express();
  app.use(express.json());
  app.use("/api/auth",authRouter);
  const server=app.listen(0,"127.0.0.1");
  return new Promise((resolve,reject)=>{
    server.once("listening",()=>{
      const address=server.address();
      resolve({server,baseUrl:`http://127.0.0.1:${address.port}`});
    });
    server.once("error",reject);
  });
}

test("public registration cannot create an admin account",async()=>{
  const originalExists=User.exists;
  const originalCreate=User.create;
  const originalSecret=process.env.JWT_SECRET;
  const originalExpiry=process.env.JWT_EXPIRES_IN;
  let createdRole=null;

  User.exists=async()=>null;
  User.create=async(payload)=>{
    createdRole=payload.role;
    return {
      _id:{toString:()=>"507f1f77bcf86cd799439011"},
      name:payload.name,
      email:payload.email,
      phone:payload.phone,
      role:payload.role,
      isActive:true,
    };
  };
  process.env.JWT_SECRET="test-secret-at-least-32-characters-long";
  process.env.JWT_EXPIRES_IN="1h";

  let server;
  try{
    const started=await startTestApp();
    server=started.server;

    const response=await fetch(`${started.baseUrl}/api/auth/register`,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        name:"Privilege Escalation Attempt",
        email:"admin-attempt@example.test",
        password:"StrongPass123!",
        role:"admin",
      }),
    });
    const body=await response.json();

    assert.equal(response.status,201);
    assert.equal(createdRole,"customer");
    assert.equal(body.user.role,"customer");
    assert.notEqual(body.user.role,"admin");

    const claims=jwt.verify(body.token,process.env.JWT_SECRET);
    assert.equal(claims.role,"customer");
    assert.notEqual(claims.role,"admin");
  }finally{
    if(server) await new Promise(resolve=>server.close(resolve));
    User.exists=originalExists;
    User.create=originalCreate;
    if(originalSecret===undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET=originalSecret;
    if(originalExpiry===undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN=originalExpiry;
  }
});
