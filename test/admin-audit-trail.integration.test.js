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
import AdminAuditLog from "../src/models/AdminAuditLog.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const SECRET="admin-audit-trail-test-secret-at-least-32-chars";

async function requestJson(base,path,{token,method="GET",body}={}){
  const response=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(body!==undefined?{"content-type":"application/json"}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json().catch(()=>({}));
  return{response,json};
}

function tokenFor(user){return jwt.sign({sub:String(user._id),ver:Number(user.authVersion||0)},SECRET,{expiresIn:"1h"});}

async function latest(action,entityId){
  return AdminAuditLog.findOne({action,entityId}).sort({createdAt:-1}).lean();
}

test("minimal admin audit trail is server-side, append-only and fail-safe",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  const oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET=SECRET;
  await mongoose.connect(uri,{dbName:"seago_admin_audit_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret});
  await Promise.all([User,Provider,Trip,Departure,Booking,CheckoutHold,AdminAuditLog].map(model=>model.init()));

  const admin=await User.create({name:"Audit Admin",email:"audit-admin@example.test",role:"admin",isActive:true});
  const owner=await User.create({name:"Audit Provider",email:"audit-provider@example.test",role:"provider",isActive:true});
  const readerProvider=await User.create({name:"Reader Provider",email:"reader-provider@example.test",role:"provider",isActive:true});
  const customer=await User.create({name:"Audit Customer",email:"audit-customer@example.test",role:"customer",isActive:true});
  const adminToken=tokenFor(admin),providerToken=tokenFor(readerProvider),customerToken=tokenFor(customer);

  const app=createApp();
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;

  const provider=await Provider.create({ownerUserId:owner._id,businessName:"Audit Marine",status:"approved",approvedAt:new Date(),approvedBy:admin._id});
  const trip=await Trip.create({providerId:provider._id,titleAr:"رحلة تدقيق",titleEn:"Audit Trip",category:"yacht",durationMinutes:90,pricing:{pricePerPerson:25,adultPrice:25,childPrice:15,commissionType:"percentage",commissionValue:20},active:true,platformStatus:"allowed"});
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:10,reservedSeats:1,status:"scheduled"});
  const booking=await Booking.create({customerId:customer._id,customerSnapshot:{name:"Audit Customer",phone:"+962790000001"},providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),pricing:{currency:"JOD",grossAmount:25,commissionAmount:5,providerNetAmount:20},idempotencyKey:"audit-booking-snapshot"});
  const hold=await CheckoutHold.create({customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,pricing:{currency:"JOD",grossAmount:25,commissionAmount:5,providerNetAmount:20},status:"active",expiresAt:new Date(Date.now()+3600000),idempotencyKey:"audit-open-hold"});

  await t.test("A: approve provider creates an audit event",async()=>{
    const pendingOwner=await User.create({name:"Approve Owner",email:"approve-owner@example.test",role:"provider",isActive:true});
    const pending=await Provider.create({ownerUserId:pendingOwner._id,businessName:"Approve Marine",status:"pending"});
    const result=await requestJson(base,`/api/admin/providers/${pending._id}/approve`,{token:adminToken,method:"PATCH",body:{actorEmail:"spoof@example.test"}});
    assert.equal(result.response.status,200);
    const event=await latest("provider_approved",pending._id);
    assert.ok(event);assert.equal(String(event.actorUserId),String(admin._id));assert.equal(event.actorEmail,admin.email);assert.deepEqual(event.before,{status:"pending"});assert.deepEqual(event.after,{status:"approved"});
  });

  await t.test("B: reject stores validated reason",async()=>{
    const rejectOwner=await User.create({name:"Reject Owner",email:"reject-owner@example.test",role:"provider",isActive:true});
    const pending=await Provider.create({ownerUserId:rejectOwner._id,businessName:"Reject Marine",status:"pending"});
    const reason="Application details incomplete";
    const result=await requestJson(base,`/api/admin/providers/${pending._id}/status`,{token:adminToken,method:"PATCH",body:{status:"rejected",reason}});
    assert.equal(result.response.status,200);
    const event=await latest("provider_rejected",pending._id);assert.equal(event.reason,reason);assert.deepEqual(event.before,{status:"pending"});assert.deepEqual(event.after,{status:"rejected"});
  });

  await t.test("C/D/O: suspend and reactivate are audited while lifecycle invariants remain intact",async()=>{
    const suspended=await requestJson(base,`/api/admin/providers/${provider._id}/status`,{token:adminToken,method:"PATCH",body:{status:"suspended",reason:"Temporary operational suspension"}});
    assert.equal(suspended.response.status,200);assert.equal((await Provider.findById(provider._id)).status,"suspended");
    assert.equal((await CheckoutHold.findById(hold._id)).status,"released");
    assert.equal((await Booking.findById(booking._id)).status,"confirmed");
    assert.equal((await Departure.findById(departure._id)).status,"scheduled");
    const suspendEvent=await latest("provider_suspended",provider._id);assert.equal(suspendEvent.reason,"Temporary operational suspension");

    const reactivated=await requestJson(base,`/api/admin/providers/${provider._id}/status`,{token:adminToken,method:"PATCH",body:{status:"approved"}});
    assert.equal(reactivated.response.status,200);assert.equal((await Provider.findById(provider._id)).status,"approved");
    const event=await latest("provider_reactivated",provider._id);assert.ok(event);assert.equal(event.reason,null);
  });

  await t.test("provider return to pending is audited",async()=>{
    const returnOwner=await User.create({name:"Return Owner",email:"return-owner@example.test",role:"provider",isActive:true});
    const rejected=await Provider.create({ownerUserId:returnOwner._id,businessName:"Return Marine",status:"rejected"});
    const result=await requestJson(base,`/api/admin/providers/${rejected._id}/status`,{token:adminToken,method:"PATCH",body:{status:"pending",reason:"Application reopened for review"}});
    assert.equal(result.response.status,200);
    const event=await latest("provider_returned_to_pending",rejected._id);assert.equal(event.reason,"Application reopened for review");
  });

  await t.test("E/F/N: platform pause and allow are audited once per actual mutation",async()=>{
    const paused=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"paused",reason:"Pause sales for operations"}});
    assert.equal(paused.response.status,200);assert.equal(paused.json.active,true);assert.equal(paused.json.platformStatus,"paused");
    const pauseEvent=await latest("trip_platform_paused",trip._id);assert.equal(pauseEvent.reason,"Pause sales for operations");assert.deepEqual(pauseEvent.before,{platformStatus:"allowed"});assert.deepEqual(pauseEvent.after,{platformStatus:"paused"});

    const allowed=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"allowed"}});
    assert.equal(allowed.response.status,200);assert.equal(allowed.json.active,true);
    const countBefore=await AdminAuditLog.countDocuments({action:"trip_platform_allowed",entityId:trip._id});
    const duplicate=await requestJson(base,`/api/admin/trips/${trip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"allowed"}});
    assert.equal(duplicate.response.status,200);
    assert.equal(await AdminAuditLog.countDocuments({action:"trip_platform_allowed",entityId:trip._id}),countBefore);
  });

  await t.test("G/P: commission audit has minimal before/after and historical booking pricing is unchanged",async()=>{
    const bookingBefore=await Booking.findById(booking._id).lean();
    const result=await requestJson(base,`/api/admin/trips/${trip._id}/commission`,{token:adminToken,method:"PATCH",body:{percentage:25,reason:"Commercial agreement update"}});
    assert.equal(result.response.status,200);
    const event=await latest("commission_updated",trip._id);assert.equal(event.reason,"Commercial agreement update");assert.equal(event.before.commissionType,"percentage");assert.equal(event.before.commissionValue,20);assert.equal(event.after.commissionValue,25);assert.equal(event.metadata.appliesTo,"future_bookings_only");
    const bookingAfter=await Booking.findById(booking._id).lean();assert.deepEqual(bookingAfter.pricing,bookingBefore.pricing);
  });

  await t.test("H/I/O: credential reset audits access facts, never credential value, and actor comes from req.user",async()=>{
    const beforeStatus=(await Provider.findById(provider._id)).status;
    const rawCredential="TemporaryPass123!";
    const result=await requestJson(base,`/api/admin/providers/${provider._id}/access`,{token:adminToken,method:"PATCH",body:{email:"audit-provider-new@example.test",name:"Audit Provider Updated",temporaryPassword:rawCredential,reason:"Security credential rotation",actorUserId:String(customer._id),actorEmail:"spoof@example.test",actorRole:"customer"}});
    assert.equal(result.response.status,200);assert.equal(result.json.provider.status,beforeStatus);assert.equal((await Provider.findById(provider._id)).status,beforeStatus);
    const event=await latest("provider_access_reset",provider._id);assert.ok(event);assert.equal(String(event.actorUserId),String(admin._id));assert.equal(event.actorEmail,admin.email);assert.equal(event.actorRole,"admin");assert.equal(event.reason,"Security credential rotation");assert.equal(event.metadata.emailChanged,true);assert.equal(event.metadata.sessionsInvalidated,true);
    const serialized=JSON.stringify(event);assert.equal(serialized.includes(rawCredential),false);assert.equal(serialized.toLowerCase().includes("passwordhash"),false);assert.equal(serialized.toLowerCase().includes("temporarypassword"),false);
  });

  await t.test("J/M: audit endpoint is admin-only, paginated, and rejects unsafe filter shapes",async()=>{
    const unauth=await requestJson(base,"/api/admin/audit");assert.equal(unauth.response.status,401);
    const providerRead=await requestJson(base,"/api/admin/audit",{token:providerToken});assert.equal(providerRead.response.status,403);
    const customerRead=await requestJson(base,"/api/admin/audit",{token:customerToken});assert.equal(customerRead.response.status,403);
    const page1=await requestJson(base,"/api/admin/audit?limit=2&page=1",{token:adminToken});assert.equal(page1.response.status,200);assert.equal(page1.json.items.length,2);assert.ok(page1.json.total>=8);assert.ok(page1.json.pages>=4);
    const page2=await requestJson(base,"/api/admin/audit?limit=2&page=2",{token:adminToken});assert.equal(page2.response.status,200);assert.equal(page2.json.items.length,2);assert.notEqual(String(page1.json.items[0]._id),String(page2.json.items[0]._id));
    const filtered=await requestJson(base,`/api/admin/audit?action=commission_updated&entityType=trip&entityId=${trip._id}`,{token:adminToken});assert.equal(filtered.response.status,200);assert.ok(filtered.json.items.every(item=>item.action==="commission_updated"&&String(item.entityId)===String(trip._id)));
    const injection=await requestJson(base,"/api/admin/audit?action[$ne]=x",{token:adminToken});assert.equal(injection.response.status,400);
  });

  await t.test("K: records cannot be updated or deleted through API or normal model methods",async()=>{
    const event=await AdminAuditLog.findOne({}).lean();assert.ok(event);
    const patch=await requestJson(base,`/api/admin/audit/${event._id}`,{token:adminToken,method:"PATCH",body:{reason:"rewrite"}});assert.equal(patch.response.status,404);
    const del=await requestJson(base,`/api/admin/audit/${event._id}`,{token:adminToken,method:"DELETE"});assert.equal(del.response.status,404);
    await assert.rejects(()=>AdminAuditLog.updateOne({_id:event._id},{$set:{reason:"rewrite"}}),/append-only/i);
    await assert.rejects(()=>AdminAuditLog.deleteOne({_id:event._id}),/append-only/i);
  });

  await t.test("L: XSS-like reason is stored as plain text",async()=>{
    const xssOwner=await User.create({name:"XSS Owner",email:"xss-owner-audit@example.test",role:"provider",isActive:true});
    const pending=await Provider.create({ownerUserId:xssOwner._id,businessName:"XSS Audit Marine",status:"pending"});
    const reason='<img src=x onerror="alert(1)">';
    const result=await requestJson(base,`/api/admin/providers/${pending._id}/status`,{token:adminToken,method:"PATCH",body:{status:"rejected",reason}});assert.equal(result.response.status,200);
    const event=await latest("provider_rejected",pending._id);assert.equal(event.reason,reason);
  });

  await t.test("failure semantics: audit insert failure rolls back the business mutation",async()=>{
    const failureTrip=await Trip.create({providerId:provider._id,titleAr:"فشل تدقيق",titleEn:"Audit Failure Trip",category:"yacht",durationMinutes:60,pricing:{pricePerPerson:20,adultPrice:20,childPrice:10,commissionType:"percentage",commissionValue:20},active:true,platformStatus:"allowed"});
    const originalCreate=AdminAuditLog.create;
    AdminAuditLog.create=async()=>{throw new Error("forced audit write failure")};
    try{
      const result=await requestJson(base,`/api/admin/trips/${failureTrip._id}/platform-status`,{token:adminToken,method:"PATCH",body:{platformStatus:"paused",reason:"Failure path test"}});
      assert.equal(result.response.status,500);
      assert.equal((await Trip.findById(failureTrip._id)).platformStatus,"allowed");
      assert.equal(await AdminAuditLog.countDocuments({entityId:failureTrip._id}),0);
    }finally{AdminAuditLog.create=originalCreate;}
  });
});
