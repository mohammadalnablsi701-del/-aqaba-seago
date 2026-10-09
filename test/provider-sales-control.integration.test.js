import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test("admin approval is the canonical provider sales gate",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  const oldSecret=process.env.JWT_SECRET;
  const oldCommission=process.env.DEFAULT_COMMISSION_PERCENTAGE;
  process.env.JWT_SECRET="provider-sales-control-test-secret-at-least-32-characters";
  process.env.DEFAULT_COMMISSION_PERCENTAGE="20";

  await mongoose.connect(uri,{dbName:"seago_provider_sales_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldCommission===undefined)delete process.env.DEFAULT_COMMISSION_PERCENTAGE;else process.env.DEFAULT_COMMISSION_PERCENTAGE=oldCommission;
  });

  await Promise.all([User,Provider,Trip,Departure].map(m=>m.init()));

  const admin=await User.create({name:"Admin",email:"sales-admin@example.test",role:"admin"});
  const owner=await User.create({name:"New Provider",email:"provider@example.test",role:"provider"});
  const provider=await Provider.create({ownerUserId:owner._id,businessName:"New Marine Operator",status:"pending"});

  const token=user=>jwt.sign({sub:String(user._id)},process.env.JWT_SECRET,{expiresIn:"1h"});
  const adminToken=token(admin),ownerToken=token(owner);

  const app=createApp();
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=`http://127.0.0.1:${port}`;

  async function request(path,{auth,method="GET",body}={}){
    const response=await fetch(base+path,{
      method,
      headers:{...(auth?{authorization:`Bearer ${auth}`}:{ }),...(body?{"content-type":"application/json"}:{})},
      body:body?JSON.stringify(body):undefined
    });
    const json=await response.json().catch(()=>null);
    return {response,json};
  }

  const tripPayload={
    titleAr:"رحلة بحرية جديدة",
    titleEn:"New marine trip",
    category:"yacht",
    durationMinutes:90,
    pricing:{adultPrice:25,childPrice:15,buffetEnabled:false}
  };

  await t.test("pending provider cannot publish trips",async()=>{
    const {response}=await request("/api/trips",{auth:ownerToken,method:"POST",body:tripPayload});
    assert.equal(response.status,403);
    const publicTrips=await request("/api/trips");
    assert.equal(publicTrips.response.status,200);
    assert.deepEqual(publicTrips.json,[]);
  });

  await t.test("admin approval unlocks normal trip and schedule publishing",async()=>{
    const approved=await request(`/api/admin/providers/${provider._id}/approve`,{auth:adminToken,method:"PATCH"});
    assert.equal(approved.response.status,200);
    assert.equal(approved.json.status,"approved");

    const created=await request("/api/trips",{auth:ownerToken,method:"POST",body:tripPayload});
    assert.equal(created.response.status,201);
    assert.equal(created.json.active,true);

    const startsAt=new Date(Date.now()+2*86400000).toISOString();
    const scheduled=await request("/api/departures",{auth:ownerToken,method:"POST",body:{tripId:created.json._id,startsAt,capacity:12}});
    assert.equal(scheduled.response.status,201);

    const publicTrips=await request("/api/trips");
    assert.equal(publicTrips.response.status,200);
    assert.equal(publicTrips.json.length,1);
    assert.equal(String(publicTrips.json[0]._id||publicTrips.json[0].id),String(created.json._id));

    const publicDepartures=await request(`/api/departures?tripId=${created.json._id}`);
    assert.equal(publicDepartures.response.status,200);
    assert.equal(publicDepartures.json.length,1);
  });

  await t.test("admin can pause and reactivate an individual trip",async()=>{
    const trip=await Trip.findOne({providerId:provider._id});
    const paused=await request(`/api/admin/trips/${trip._id}/active`,{auth:adminToken,method:"PATCH",body:{active:false}});
    assert.equal(paused.response.status,200);
    assert.equal(paused.json.active,false);
    assert.equal(paused.json.sellable,false);

    const hidden=await request("/api/trips");
    assert.deepEqual(hidden.json,[]);

    const active=await request(`/api/admin/trips/${trip._id}/active`,{auth:adminToken,method:"PATCH",body:{active:true}});
    assert.equal(active.response.status,200);
    assert.equal(active.json.active,true);
    assert.equal(active.json.sellable,true);
  });

  await t.test("suspending provider blocks all sales and management without editing trips",async()=>{
    const suspended=await request(`/api/admin/providers/${provider._id}/status`,{auth:adminToken,method:"PATCH",body:{status:"suspended"}});
    assert.equal(suspended.response.status,200);
    assert.equal(suspended.json.status,"suspended");

    const publicTrips=await request("/api/trips");
    assert.deepEqual(publicTrips.json,[]);
    const publicDepartures=await request("/api/departures");
    assert.deepEqual(publicDepartures.json,[]);

    const denied=await request("/api/trips",{auth:ownerToken,method:"POST",body:{...tripPayload,titleEn:"Blocked while suspended"}});
    assert.equal(denied.response.status,403);
  });
});
