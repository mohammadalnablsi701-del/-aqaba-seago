import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import {createApp} from "../src/app.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import Booking from "../src/models/Booking.js";
import CheckoutHold from "../src/models/CheckoutHold.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const SECRET="admin-sensitive-actions-test-secret-at-least-32-chars";

async function requestJson(base,path,{token,method="GET",body}={}){
  const response=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(body!==undefined?{"content-type":"application/json"}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json().catch(()=>({}));return{response,json};
}

test("sensitive admin actions enforce safety without changing lifecycle semantics",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  const oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET=SECRET;
  await mongoose.connect(uri,{dbName:"seago_admin_sensitive_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret});
  await Promise.all([User,Provider,Trip,Departure,Booking,CheckoutHold].map(m=>m.init()));

  const admin=await User.create({name:"Admin",email:"admin-sensitive@example.test",role:"admin"});
  const owner=await User.create({name:"Provider",email:"provider-sensitive@example.test",role:"provider",isActive:true});
  const customer=await User.create({name:"Customer",email:"customer-sensitive@example.test",role:"customer"});
  const tokenFor=user=>jwt.sign({sub:String(user._id),ver:Number(user.authVersion||0)},SECRET,{expiresIn:"1h"});
  const adminToken=tokenFor(admin),providerToken=tokenFor(owner),customerToken=tokenFor(customer);
  const app=createApp();const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;

  const provider=await Provider.create({ownerUserId:owner._id,businessName:"Safety Marine",status:"approved",approvedAt:new Date(),approvedBy:admin._id});
  const trip=await Trip.create({providerId:provider._id,titleAr:"رحلة أمان",titleEn:"Safety Trip",category:"yacht",durationMinutes:90,pricing:{pricePerPerson:25,adultPrice:25,childPrice:15,commissionType:"percentage",commissionValue:20},active:true,platformStatus:"allowed"});
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:10,reservedSeats:2,status:"scheduled"});
  const confirmed=await Booking.create({customerId:customer._id,customerSnapshot:{name:"Customer",phone:"+962790000000"},providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),pricing:{currency:"JOD",grossAmount:25,commissionAmount:5,providerNetAmount:20},idempotencyKey:"confirmed-before-suspend"});
  const hold=await CheckoutHold.create({customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,pricing:{currency:"JOD",grossAmount:25,commissionAmount:5,providerNetAmount:20},status:"active",expiresAt:new Date(Date.now()+3600000),idempotencyKey:"open-hold-before-suspend"});

  await t.test("K: customer and provider roles cannot invoke admin endpoints",async()=>{
    for(const token of [customerToken,providerToken]){
      const status=await requestJson(base,`/api/admin/providers/${provider._id}/status`,{token,method:"PATCH",body:{status:"suspended",reason:"Unauthorized attempt"}});assert.equal(status.response.status,403);
      const pause=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token,method:"PATCH",body:{platformStatus:"paused",reason:"Unauthorized attempt"}});assert.equal(pause.response.status,403);
      const commission=await requestJson(base,`/api/admin/trips/${trip._id}/commission`,{token,method:"PATCH",body:{percentage:25,reason:"Unauthorized attempt"}});assert.equal(commission.response.status,403);
    }
  });

  await t.test("B/C: reject requires a non-whitespace reason",async()=>{
    const pendingOwner=await User.create({name:"Pending",email:"pending-sensitive@example.test",role:"provider",isActive:true});
    const pending=await Provider.create({ownerUserId:pendingOwner._id,businessName:"Pending Safety",status:"pending"});
    const missing=await requestJson(base,`/api/admin/providers/${pending._id}/status`,{token:adminToken,method:"PATCH",body:{status:"rejected"}});assert.equal(missing.response.status,400);
    const whitespace=await requestJson(base,`/api/admin/providers/${pending._id}/status`,{token:adminToken,method:"PATCH",body:{status:"rejected",reason:"   "}});assert.equal(whitespace.response.status,400);
    assert.equal((await Provider.findById(pending._id)).status,"pending");
    const rejected=await requestJson(base,`/api/admin/providers/${pending._id}/status`,{token:adminToken,method:"PATCH",body:{status:"rejected",reason:"Application details incomplete"}});assert.equal(rejected.response.status,200);assert.equal(rejected.json.status,"rejected");
  });

  await t.test("H: suspend releases open holds but preserves confirmed bookings and departures",async()=>{
    const whitespace=await requestJson(base,`/api/admin/providers/${provider._id}/status`,{token:adminToken,method:"PATCH",body:{status:"suspended",reason:"   "}});assert.equal(whitespace.response.status,400);assert.equal((await Provider.findById(provider._id)).status,"approved");
    const suspended=await requestJson(base,`/api/admin/providers/${provider._id}/status`,{token:adminToken,method:"PATCH",body:{status:"suspended",reason:"Temporary operational suspension"}});assert.equal(suspended.response.status,200);
    assert.equal((await Provider.findById(provider._id)).status,"suspended");
    assert.equal((await CheckoutHold.findById(hold._id)).status,"released");
    assert.equal((await Booking.findById(confirmed._id)).status,"confirmed");
    assert.equal((await Departure.findById(departure._id)).status,"scheduled");
  });

  await t.test("F/G: platform pause and allow never change provider-controlled Trip.active",async()=>{
    const reactivate=await requestJson(base,`/api/admin/providers/${provider._id}/status`,{token:adminToken,method:"PATCH",body:{status:"approved"}});assert.equal(reactivate.response.status,200);
    const noReason=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"paused"}});assert.equal(noReason.response.status,400);
    const paused=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"paused",reason:"Pause sales for operations"}});assert.equal(paused.response.status,200);assert.equal(paused.json.active,true);assert.equal(paused.json.platformStatus,"paused");assert.equal((await Trip.findById(trip._id)).active,true);
    const allowed=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"allowed"}});assert.equal(allowed.response.status,200);assert.equal(allowed.json.active,true);assert.equal(allowed.json.platformStatus,"allowed");assert.equal((await Trip.findById(trip._id)).active,true);
  });

  await t.test("I: commission change requires reason and preserves existing booking snapshots",async()=>{
    const beforeBooking=await Booking.findById(confirmed._id).lean();
    const noReason=await requestJson(base,`/api/admin/trips/${trip._id}/commission`,{token:adminToken,method:"PATCH",body:{percentage:25}});assert.equal(noReason.response.status,400);assert.equal((await Trip.findById(trip._id)).pricing.commissionValue,20);
    const changed=await requestJson(base,`/api/admin/trips/${trip._id}/commission`,{token:adminToken,method:"PATCH",body:{percentage:25,reason:"Commercial agreement update"}});assert.equal(changed.response.status,200);assert.equal(changed.json.pricing.commissionType,"percentage");assert.equal(changed.json.pricing.commissionValue,25);
    const afterBooking=await Booking.findById(confirmed._id).lean();assert.equal(afterBooking.pricing.commissionAmount,beforeBooking.pricing.commissionAmount);assert.equal(afterBooking.pricing.grossAmount,beforeBooking.pricing.grossAmount);
  });

  await t.test("J: Manage Access reason is required and provider lifecycle remains unchanged",async()=>{
    const before=(await Provider.findById(provider._id)).status;
    const noReason=await requestJson(base,`/api/admin/providers/${provider._id}/access`,{token:adminToken,method:"PATCH",body:{email:"provider-sensitive@example.test",name:"Provider",temporaryPassword:"TemporaryPass123!"}});assert.equal(noReason.response.status,400);assert.equal((await Provider.findById(provider._id)).status,before);
    const updated=await requestJson(base,`/api/admin/providers/${provider._id}/access`,{token:adminToken,method:"PATCH",body:{email:"provider-sensitive@example.test",name:"Provider",temporaryPassword:"TemporaryPass123!",reason:"Security credential rotation"}});assert.equal(updated.response.status,200);assert.equal(updated.json.provider.status,before);assert.equal((await Provider.findById(provider._id)).status,before);
  });

  await t.test("L: reason is treated as plain text metadata, not executable input",async()=>{
    const pendingOwner=await User.create({name:"XSS Pending",email:"xss-pending@example.test",role:"provider",isActive:true});
    const pending=await Provider.create({ownerUserId:pendingOwner._id,businessName:"XSS Safety",status:"pending"});
    const reason='<img src=x onerror="globalThis.pwned=true">';
    const result=await requestJson(base,`/api/admin/providers/${pending._id}/status`,{token:adminToken,method:"PATCH",body:{status:"rejected",reason}});assert.equal(result.response.status,200);assert.equal((await Provider.findById(pending._id)).status,"rejected");
  });
});
