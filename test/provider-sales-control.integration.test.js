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
import Booking from "../src/models/Booking.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Payment from "../src/models/Payment.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test("provider and platform trip sales authority are independent",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  const oldSecret=process.env.JWT_SECRET;
  const oldCommission=process.env.DEFAULT_COMMISSION_PERCENTAGE;
  const oldPaymentProvider=process.env.PAYMENT_PROVIDER;
  process.env.JWT_SECRET="provider-sales-control-test-secret-at-least-32-characters";
  process.env.DEFAULT_COMMISSION_PERCENTAGE="20";
  process.env.PAYMENT_PROVIDER="mock";

  await mongoose.connect(uri,{dbName:"seago_provider_sales_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldCommission===undefined)delete process.env.DEFAULT_COMMISSION_PERCENTAGE;else process.env.DEFAULT_COMMISSION_PERCENTAGE=oldCommission;
    if(oldPaymentProvider===undefined)delete process.env.PAYMENT_PROVIDER;else process.env.PAYMENT_PROVIDER=oldPaymentProvider;
  });

  await Promise.all([User,Provider,Trip,Departure,Booking,CheckoutHold,Payment].map(m=>m.init()));

  const admin=await User.create({name:"Admin",email:"sales-admin@example.test",role:"admin"});
  const owner=await User.create({name:"Provider A",email:"provider-a@example.test",role:"provider"});
  const ownerB=await User.create({name:"Provider B",email:"provider-b@example.test",role:"provider"});
  const customer=await User.create({name:"Customer",email:"customer@example.test",role:"customer"});
  const provider=await Provider.create({ownerUserId:owner._id,businessName:"Marine Operator A",status:"approved"});
  const providerB=await Provider.create({ownerUserId:ownerB._id,businessName:"Marine Operator B",status:"approved"});

  const token=user=>jwt.sign({sub:String(user._id)},process.env.JWT_SECRET,{expiresIn:"1h"});
  const adminToken=token(admin),ownerToken=token(owner),ownerBToken=token(ownerB),customerToken=token(customer);

  const app=createApp();
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=`http://127.0.0.1:${port}`;

  async function request(path,{auth,method="GET",body,headers={}}={}){
    const response=await fetch(base+path,{
      method,
      headers:{...(auth?{authorization:`Bearer ${auth}`}:{ }),...(body?{"content-type":"application/json"}:{}),...headers},
      body:body?JSON.stringify(body):undefined
    });
    const json=await response.json().catch(()=>null);
    return {response,json};
  }

  const tripPayload={titleAr:"رحلة بحرية",titleEn:"Authority trip",category:"yacht",durationMinutes:90,pricing:{adultPrice:25,childPrice:15,buffetEnabled:false}};
  const created=await request("/api/trips",{auth:ownerToken,method:"POST",body:tripPayload});
  assert.equal(created.response.status,201);
  assert.equal(created.json.active,true);
  assert.equal(created.json.platformStatus,"allowed");
  const tripId=created.json._id;
  const startsAt=new Date(Date.now()+2*86400000).toISOString();
  const scheduled=await request("/api/departures",{auth:ownerToken,method:"POST",body:{tripId,startsAt,capacity:12}});
  assert.equal(scheduled.response.status,201);
  const departureId=scheduled.json._id;

  async function providerPatch(body){return request(`/api/trips/${tripId}`,{auth:ownerToken,method:"PATCH",body})}
  async function adminPlatform(platformStatus){return request(`/api/admin/trips/${tripId}/platform-status`,{auth:adminToken,method:"PATCH",body:{platformStatus}})}
  async function tripDoc(){return Trip.findById(tripId).lean()}
  async function publicTripVisible(){const r=await request("/api/trips");return r.json.some(x=>String(x._id||x.id)===String(tripId))}
  async function publicDepartureVisible(){const r=await request(`/api/departures?tripId=${tripId}`);return r.json.some(x=>String(x.id||x._id)===String(departureId))}

  await t.test("A: provider active + platform allowed is sellable subject to departure gates",async()=>{
    assert.equal(await publicTripVisible(),true);
    assert.equal(await publicDepartureVisible(),true);
    const quote=await request(`/api/departures/${departureId}/quote?adults=1&children=0`);
    assert.equal(quote.response.status,200);
  });

  await t.test("B: provider paused + platform allowed is not sellable",async()=>{
    const r=await providerPatch({active:false});assert.equal(r.response.status,200);
    const doc=await tripDoc();assert.equal(doc.active,false);assert.notEqual(doc.platformStatus,"paused");
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
  });

  await t.test("E/F: Admin pause/allow never changes provider active",async()=>{
    await providerPatch({active:true});
    const paused=await adminPlatform("paused");assert.equal(paused.response.status,200);assert.equal(paused.json.active,true);assert.equal(paused.json.platformStatus,"paused");
    assert.equal((await tripDoc()).active,true);
    const allowed=await adminPlatform("allowed");assert.equal(allowed.response.status,200);assert.equal(allowed.json.active,true);assert.equal(allowed.json.platformStatus,"allowed");
    assert.equal((await tripDoc()).active,true);
  });

  await t.test("C: provider active + platform paused is not sellable",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
    const quote=await request(`/api/departures/${departureId}/quote?adults=1&children=0`);assert.equal(quote.response.status,404);
  });

  await t.test("D: provider paused + platform paused is not sellable",async()=>{
    await providerPatch({active:false});
    const doc=await tripDoc();assert.equal(doc.active,false);assert.equal(doc.platformStatus,"paused");
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
  });

  await t.test("G/H: provider toggles only active and cannot override platform state",async()=>{
    await adminPlatform("paused");
    const attempted=await providerPatch({active:true,platformStatus:"allowed"});assert.equal(attempted.response.status,200);
    const doc=await tripDoc();assert.equal(doc.active,true);assert.equal(doc.platformStatus,"paused");
    const pausedByProvider=await providerPatch({active:false});assert.equal(pausedByProvider.response.status,200);
    const doc2=await tripDoc();assert.equal(doc2.active,false);assert.equal(doc2.platformStatus,"paused");
  });

  await t.test("provider A cannot edit provider B trip",async()=>{
    const other=await Trip.create({providerId:providerB._id,titleAr:"رحلة ب",titleEn:"Provider B trip",category:"yacht",durationMinutes:60,pricing:{pricePerPerson:20,adultPrice:20,childPrice:10,commissionValue:20},active:true});
    const denied=await request(`/api/trips/${other._id}`,{auth:ownerToken,method:"PATCH",body:{active:false}});assert.equal(denied.response.status,404);
    const unchanged=await Trip.findById(other._id).lean();assert.equal(unchanged.active,true);
    const own=await request(`/api/trips/${other._id}`,{auth:ownerBToken,method:"PATCH",body:{active:false}});assert.equal(own.response.status,200);
  });

  await t.test("I: platform-paused trip cannot checkout directly by departure ID",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    const before=await Departure.findById(departureId).lean();
    const checkout=await request("/api/payments/checkout",{auth:customerToken,method:"POST",headers:{"idempotency-key":"platform-paused-checkout"},body:{departureId:String(departureId),adults:1,children:0,mealPlan:"without_buffet"}});
    assert.equal(checkout.response.status,409);
    assert.match(checkout.json.error,/Trip unavailable/);
    const after=await Departure.findById(departureId).lean();assert.equal(after.reservedSeats,before.reservedSeats);
  });

  await t.test("J: confirmed bookings remain operational after platform pause",async()=>{
    const booking=await Booking.create({customerId:customer._id,customerSnapshot:{name:"Customer",phone:"+962700000000"},providerId:provider._id,tripId,departureId,seats:1,adults:1,children:0,mealPlan:"without_buffet",status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),pricing:{currency:"JOD",grossAmount:25,commissionAmount:5,providerNetAmount:20},idempotencyKey:"existing-confirmed-booking"});
    await adminPlatform("paused");
    const list=await request("/api/providers/me/bookings",{auth:ownerToken});assert.equal(list.response.status,200);
    assert.equal(list.json.some(x=>String(x._id)===String(booking._id)),true);
    const detail=await request(`/api/providers/me/bookings/${booking._id}`,{auth:ownerToken});assert.equal(detail.response.status,200);
  });

  await t.test("K: public departures do not sell a platform-paused trip",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    assert.equal(await publicDepartureVisible(),false);
  });

  await t.test("L: provider suspension blocks sales regardless of both trip states",async()=>{
    await providerPatch({active:true});await adminPlatform("allowed");
    await Provider.findByIdAndUpdate(provider._id,{$set:{status:"suspended"}});
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
    const checkout=await request("/api/payments/checkout",{auth:customerToken,method:"POST",headers:{"idempotency-key":"suspended-provider-checkout"},body:{departureId:String(departureId),adults:1,children:0}});assert.equal(checkout.response.status,409);
    await Provider.findByIdAndUpdate(provider._id,{$set:{status:"approved"}});
  });

  await t.test("M: Duplicate cannot bypass an Admin platform hold",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    const duplicate=await request("/api/trips",{auth:ownerToken,method:"POST",body:{...tripPayload,titleEn:"Authority trip copy",duplicateFromTripId:String(tripId),active:true,platformStatus:"allowed"}});
    assert.equal(duplicate.response.status,201);assert.equal(duplicate.json.active,true);assert.equal(duplicate.json.platformStatus,"paused");
    const publicTrips=await request("/api/trips");assert.equal(publicTrips.json.some(x=>String(x._id)===String(duplicate.json._id)),false);
  });

  await t.test("legacy trips missing platformStatus remain allowed without migration",async()=>{
    const legacyId=new mongoose.Types.ObjectId();
    await Trip.collection.insertOne({_id:legacyId,providerId:provider._id,titleAr:"قديمة",titleEn:"Legacy trip",category:"yacht",durationMinutes:60,pricing:{currency:"JOD",pricePerPerson:18,adultPrice:18,childPrice:10,commissionType:"percentage",commissionValue:20},active:true,createdAt:new Date(),updatedAt:new Date()});
    const publicTrips=await request("/api/trips");assert.equal(publicTrips.json.some(x=>String(x._id||x.id)===String(legacyId)),true);
  });

  await t.test("legacy Admin shared-active endpoint can no longer mutate provider state",async()=>{
    await providerPatch({active:true});const before=await tripDoc();
    const old=await request(`/api/admin/trips/${tripId}/active`,{auth:adminToken,method:"PATCH",body:{active:false}});assert.equal(old.response.status,410);
    const after=await tripDoc();assert.equal(after.active,before.active);assert.equal(after.platformStatus,before.platformStatus);
  });
});
