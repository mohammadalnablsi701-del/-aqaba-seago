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

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const pricing={currency:"JOD",pricePerPerson:20,adultPrice:20,childPrice:10,commissionType:"percentage",commissionValue:20};

test("Admin reports Provider Active, Platform Allowed and Sellable Now independently",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET="admin-sellability-test-secret-at-least-32-characters";
  await mongoose.connect(uri,{dbName:"seago_admin_sellability_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });
  await Promise.all([User,Provider,Trip,Departure,Booking].map(m=>m.init()));

  const admin=await User.create({name:"Admin",email:"sellability-admin@example.test",role:"admin"});
  const owner=await User.create({name:"Approved Owner",email:"sellability-provider@example.test",role:"provider"});
  const suspendedOwner=await User.create({name:"Suspended Owner",email:"sellability-suspended@example.test",role:"provider"});
  const customer=await User.create({name:"Customer",email:"sellability-customer@example.test",role:"customer"});
  const approved=await Provider.create({ownerUserId:owner._id,businessName:"Approved Marine",status:"approved"});
  const suspended=await Provider.create({ownerUserId:suspendedOwner._id,businessName:"Suspended Marine",status:"suspended"});

  async function makeTrip(providerId,title,{active=true,platformStatus="allowed"}={}){
    return Trip.create({providerId,titleAr:title,titleEn:title,category:"yacht",durationMinutes:60,pricing,active,platformStatus});
  }
  const openTrip=await makeTrip(approved._id,"Open trip");
  const providerPausedTrip=await makeTrip(approved._id,"Provider paused",{active:false});
  const platformPausedTrip=await makeTrip(approved._id,"Platform paused",{platformStatus:"paused"});
  const noDepartureTrip=await makeTrip(approved._id,"Eligible no departure");
  const suspendedTrip=await makeTrip(suspended._id,"Suspended provider trip");

  const legacyId=new mongoose.Types.ObjectId();
  await Trip.collection.insertOne({_id:legacyId,providerId:approved._id,titleAr:"Legacy",titleEn:"Legacy",category:"yacht",durationMinutes:60,pricing,active:true,createdAt:new Date(),updatedAt:new Date()});

  const future=n=>new Date(Date.now()+n*86400000);
  const openDeparture=await Departure.create({tripId:openTrip._id,startsAt:future(2),capacity:10,reservedSeats:2});
  await Departure.create({tripId:legacyId,startsAt:future(3),capacity:8,reservedSeats:0});
  const pausedDeparture=await Departure.create({tripId:platformPausedTrip._id,startsAt:future(4),capacity:9,reservedSeats:0});
  await Departure.create({tripId:noDepartureTrip._id,startsAt:future(5),capacity:5,reservedSeats:5});

  await Booking.create({
    customerId:customer._id,customerSnapshot:{name:"Customer",phone:"+962700000000"},providerId:approved._id,
    tripId:platformPausedTrip._id,departureId:pausedDeparture._id,seats:1,adults:1,children:0,status:"confirmed",
    holdExpiresAt:future(1),pricing:{currency:"JOD",grossAmount:20,commissionAmount:4,providerNetAmount:16},idempotencyKey:"paused-confirmed"
  });

  const token=jwt.sign({sub:String(admin._id)},process.env.JWT_SECRET,{expiresIn:"1h"});
  const app=createApp();
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function get(path){const r=await fetch(base+path,{headers:{authorization:`Bearer ${token}`}});return {status:r.status,json:await r.json()};}

  const tripsResult=await get("/api/admin/trips");
  assert.equal(tripsResult.status,200);
  const byTitle=new Map(tripsResult.json.map(x=>[x.titleEn,x]));
  assert.equal(byTitle.get("Open trip").sellability.sellableNow,true);
  assert.equal(byTitle.get("Provider paused").sellability.state,"provider_paused");
  assert.equal(byTitle.get("Platform paused").sellability.state,"platform_paused");
  assert.equal(byTitle.get("Suspended provider trip").sellability.state,"provider_blocked");
  assert.equal(byTitle.get("Eligible no departure").sellability.salesEligible,true);
  assert.equal(byTitle.get("Eligible no departure").sellability.sellableNow,false);
  assert.equal(byTitle.get("Legacy").sellability.platformAllowed,true);
  assert.equal(byTitle.get("Legacy").sellability.sellableNow,true);
  assert.equal(byTitle.get("Platform paused").financials.confirmedBookings,1,"confirmed history must remain visible after current sellability changes");

  const providersResult=await get("/api/admin/providers");
  assert.equal(providersResult.status,200);
  const approvedRow=providersResult.json.find(x=>x.businessName==="Approved Marine");
  assert.equal(approvedRow.operations.providerActiveTripCount,4,"platform pause must not reduce Provider Active");
  assert.equal(approvedRow.operations.activeTripCount,4,"legacy activeTripCount remains a compatibility alias for Provider Active");
  assert.equal(approvedRow.operations.platformAllowedTripCount,4,"provider pause must not reduce Platform Allowed");
  assert.equal(approvedRow.operations.salesEligibleTripCount,3);
  assert.equal(approvedRow.operations.sellableNowTripCount,2);
  const suspendedRow=providersResult.json.find(x=>x.businessName==="Suspended Marine");
  assert.equal(suspendedRow.operations.providerActiveTripCount,1);
  assert.equal(suspendedRow.operations.platformAllowedTripCount,1);
  assert.equal(suspendedRow.operations.salesEligibleTripCount,0);
  assert.equal(suspendedRow.operations.sellableNowTripCount,0);

  const readiness=await get("/api/admin/readiness");
  assert.equal(readiness.status,200);
  assert.equal(readiness.json.counts.providerActiveTrips,5);
  assert.equal(readiness.json.counts.platformAllowedTrips,5);
  assert.equal(readiness.json.counts.salesEligibleTrips,3);
  assert.equal(readiness.json.counts.activeTrips,3,"legacy readiness activeTrips is the sales-eligible compatibility alias");
  assert.equal(readiness.json.counts.sellableTrips,2);
  assert.equal(readiness.json.counts.sellableDepartures,2);
  assert.equal(readiness.json.counts.confirmedBookings,1);
  assert.equal(readiness.json.checks.find(x=>x.id==="departures").label,"At least one sellable departure now");
  assert.equal(readiness.json.checks.find(x=>x.id==="departures").ok,true);

  // Closing the only two actually sellable departures must make readiness truth change,
  // without touching confirmed booking history or provider-controlled trip state.
  await Departure.updateMany({_id:{$in:[openDeparture._id]},tripId:openTrip._id},{$set:{salesClosed:true}});
  await Departure.updateMany({tripId:legacyId},{$set:{salesClosed:true}});
  const afterClose=await get("/api/admin/readiness");
  assert.equal(afterClose.json.counts.salesEligibleTrips,3);
  assert.equal(afterClose.json.counts.sellableTrips,0);
  assert.equal(afterClose.json.counts.sellableDepartures,0);
  assert.equal(afterClose.json.counts.confirmedBookings,1);
  assert.equal(afterClose.json.checks.find(x=>x.id==="departures").ok,false);
  assert.equal((await Trip.findById(platformPausedTrip._id).lean()).active,true);
});
