import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import Booking from "../src/models/Booking.js";
import Payment from "../src/models/Payment.js";
import { applyPilotRepairStage2a, previewPilotRepairStage2a } from "../src/services/pilotRepairStage2a.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

function tripDoc(providerId,titleEn,{adultPrice=20,childPrice=10,buffet=false}={}){
  return {
    providerId,
    titleAr:`اختبار ${titleEn}`,
    titleEn,
    category:"sunset",
    durationMinutes:120,
    active:true,
    pricing:{
      currency:"JOD",
      pricePerPerson:adultPrice,
      adultPrice,
      childPrice,
      buffetEnabled:buffet,
      buffetAdultPrice:buffet?25:adultPrice,
      buffetChildPrice:buffet?15:childPrice,
      commissionType:"percentage",
      commissionValue:20
    }
  };
}

test("Stage 2A corrects only approved pilot inventory and preserves confirmed financial snapshots",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  await mongoose.connect(uri,{dbName:"seago_pilot_repair_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
  await Promise.all([User,Provider,Trip,Departure,Booking,Payment].map(model=>model.init()));

  const [funOwner,aladdinOwner,customer]=await User.create([
    {name:"Fun Owner",email:"fun-owner@example.test",role:"provider"},
    {name:"Aladdin Owner",email:"aladdin-owner@example.test",role:"provider"},
    {name:"Customer",email:"customer@example.test",role:"customer"}
  ]);
  const [funProvider,aladdinProvider]=await Provider.create([
    {ownerUserId:funOwner._id,businessName:"Fun N Sun",status:"approved"},
    {ownerUserId:aladdinOwner._id,businessName:"Aladdin Yachts & Marine Tours / Alaa Aldeen",status:"approved"}
  ]);

  const [swim,evening,coral]=await Trip.create([
    tripDoc(funProvider._id,"White Prince Swimming Cruise",{adultPrice:15,childPrice:10,buffet:true}),
    tripDoc(funProvider._id,"White Prince Evening Cruise",{adultPrice:20}),
    tripDoc(funProvider._id,"Coral Whisper + White Prince Experience",{adultPrice:25})
  ]);
  const [aladdin8,sukar]=await Trip.create([
    tripDoc(aladdinProvider._id,"Aladdin 8",{adultPrice:13}),
    tripDoc(aladdinProvider._id,"Sukar",{adultPrice:13})
  ]);

  const pastFunDeparture=await Departure.create({tripId:swim._id,startsAt:new Date(Date.now()-86400000),capacity:20,reservedSeats:3,status:"completed",salesClosed:true});
  const futureAladdinDeparture=await Departure.create({tripId:sukar._id,startsAt:new Date(Date.now()+86400000),capacity:20,reservedSeats:3,status:"scheduled",salesClosed:false});

  const funBooking=await Booking.create({
    customerId:customer._id,providerId:funProvider._id,tripId:swim._id,departureId:pastFunDeparture._id,
    seats:3,adults:2,children:1,mealPlan:"with_buffet",status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:"fun-confirmed",
    pricing:{currency:"JOD",adultUnitPrice:20,childUnitPrice:15,adultSubtotal:40,childSubtotal:15,grossAmount:55,commissionAmount:11,providerNetAmount:44}
  });
  const aladdinBooking=await Booking.create({
    customerId:customer._id,providerId:aladdinProvider._id,tripId:sukar._id,departureId:futureAladdinDeparture._id,
    seats:3,adults:3,children:0,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:"aladdin-confirmed",
    pricing:{currency:"JOD",adultUnitPrice:13,childUnitPrice:13,adultSubtotal:39,childSubtotal:0,grossAmount:39,commissionAmount:7.8,providerNetAmount:31.2}
  });
  const aladdinPayment=await Payment.create({
    bookingId:aladdinBooking._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:"mock",externalPaymentId:"repair-test-paid",status:"paid",amount:39,currency:"JOD",paidAt:new Date()
  });

  const funBefore=await Booking.findById(funBooking._id).lean();
  const aladdinBookingBefore=await Booking.findById(aladdinBooking._id).lean();
  const paymentBefore=await Payment.findById(aladdinPayment._id).lean();

  const preview=await previewPilotRepairStage2a();
  assert.equal(preview.ok,true);
  assert.equal(preview.changesRequired,true);
  assert.equal(preview.funNSun.tripCount,3);
  assert.equal(preview.aladdin.tripCount,2);
  assert.equal(preview.aladdin.confirmedBookings,1);
  assert.equal(preview.aladdin.paidPayments,1);
  const swimPreview=preview.funNSun.trips.find(x=>x.titleEn==="White Prince Swimming Cruise");
  assert.equal(swimPreview.recordedCommission,11);
  assert.equal(swimPreview.expectedCommissionForHistoricalBookings,13);
  assert.equal(swimPreview.historicalCommissionDelta,2);

  const result=await applyPilotRepairStage2a();
  assert.equal(result.applied,true);
  assert.deepEqual(result.changed,{funTrips:3,aladdinProvider:1,aladdinTrips:2,aladdinDepartures:1});
  assert.equal(result.after.ok,true);
  assert.equal(result.after.changesRequired,false);

  const repairedTrips=await Trip.find({providerId:funProvider._id}).lean();
  const repairedSwim=repairedTrips.find(x=>x.titleEn==="White Prince Swimming Cruise");
  const repairedEvening=repairedTrips.find(x=>x.titleEn==="White Prince Evening Cruise");
  const repairedCoral=repairedTrips.find(x=>x.titleEn==="Coral Whisper + White Prince Experience");
  assert.equal(repairedSwim.pricing.commissionType,"fixed_per_person");
  assert.equal(repairedSwim.pricing.adultCommission,3);
  assert.equal(repairedSwim.pricing.childCommission,2);
  assert.equal(repairedSwim.pricing.buffetAdultCommission,5);
  assert.equal(repairedSwim.pricing.buffetChildCommission,3);
  assert.equal(repairedEvening.pricing.commissionType,"fixed_per_person");
  assert.equal(repairedEvening.pricing.commissionValue,5);
  assert.equal(repairedCoral.pricing.commissionValue,5);

  assert.equal((await Provider.findById(aladdinProvider._id).lean()).status,"suspended");
  assert.equal(await Trip.countDocuments({providerId:aladdinProvider._id,active:true}),0);
  assert.equal((await Departure.findById(futureAladdinDeparture._id).lean()).salesClosed,true);

  const funAfter=await Booking.findById(funBooking._id).lean();
  const aladdinBookingAfter=await Booking.findById(aladdinBooking._id).lean();
  const paymentAfter=await Payment.findById(aladdinPayment._id).lean();
  assert.deepEqual(funAfter.pricing,funBefore.pricing);
  assert.deepEqual(aladdinBookingAfter.pricing,aladdinBookingBefore.pricing);
  assert.equal(String(funAfter.updatedAt),String(funBefore.updatedAt));
  assert.equal(String(aladdinBookingAfter.updatedAt),String(aladdinBookingBefore.updatedAt));
  assert.equal(paymentAfter.status,paymentBefore.status);
  assert.equal(paymentAfter.amount,paymentBefore.amount);
  assert.equal(String(paymentAfter.updatedAt),String(paymentBefore.updatedAt));

  const second=await applyPilotRepairStage2a();
  assert.equal(second.applied,false);
  assert.deepEqual(second.changed,{funTrips:0,aladdinProvider:0,aladdinTrips:0,aladdinDepartures:0});
});
