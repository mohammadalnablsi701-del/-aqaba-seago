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
import ProviderSettlement from "../src/models/ProviderSettlement.js";
import { applyPilotFinancialStage2b, previewPilotFinancialStage2b } from "../src/services/pilotFinancialStage2b.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

function paymentSnapshot(raw){
  return {
    hasSettlementRevision:Object.prototype.hasOwnProperty.call(raw,"settlementRevision"),
    settlementRevision:raw.settlementRevision,
    status:raw.status,
    amount:raw.amount,
    currency:raw.currency,
    refundedAmount:raw.refundedAmount,
    paidAt:raw.paidAt?.toISOString?.()||null,
    updatedAt:raw.updatedAt?.toISOString?.()||null
  };
}

test("Stage 2B corrects exactly 30 JOD, preserves Payment records, is idempotent, and blocks settled history",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  await mongoose.connect(uri,{dbName:"seago_stage2b_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
  await Promise.all([User,Provider,Trip,Departure,Booking,Payment,ProviderSettlement].map(model=>model.init()));

  const [owner,customer,admin]=await User.create([
    {name:"Fun Owner",email:"stage2b-owner@example.test",role:"provider"},
    {name:"Customer",email:"stage2b-customer@example.test",role:"customer"},
    {name:"Admin",email:"stage2b-admin@example.test",role:"admin"}
  ]);
  const provider=await Provider.create({ownerUserId:owner._id,businessName:"Fun N Sun",status:"approved"});
  const trip=await Trip.create({
    providerId:provider._id,titleAr:"تجربة كورال ويسبر ووايت برنس",titleEn:"Coral Whisper + White Prince Experience",
    category:"group_boat",durationMinutes:180,active:true,
    pricing:{currency:"JOD",pricePerPerson:25,adultPrice:25,childPrice:12,commissionType:"fixed_per_person",commissionValue:5}
  });
  const departure=await Departure.create({
    tripId:trip._id,startsAt:new Date(Date.now()-86400000),capacity:20,reservedSeats:6,status:"completed",salesClosed:true
  });
  const [bookingA,bookingB]=await Booking.create([
    {
      customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,
      seats:2,adults:2,children:0,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:"stage2b-a",
      pricing:{currency:"JOD",adultUnitPrice:25,adultSubtotal:50,childSubtotal:0,grossAmount:50,commissionAmount:0,providerNetAmount:50}
    },
    {
      customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,
      seats:4,adults:3,children:1,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:"stage2b-b",
      pricing:{currency:"JOD",adultUnitPrice:25,childUnitPrice:12,adultSubtotal:75,childSubtotal:12,grossAmount:87,commissionAmount:0,providerNetAmount:87}
    }
  ]);

  const now=new Date();
  const paymentA=await Payment.create({
    bookingId:bookingA._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:"mock",
    externalPaymentId:"stage2b-paid-a",status:"paid",settlementRevision:7,amount:50,currency:"JOD",paidAt:now,refundedAmount:0
  });
  const paymentBId=new mongoose.Types.ObjectId();
  await Payment.collection.insertOne({
    _id:paymentBId,bookingId:bookingB._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:"mock",
    externalPaymentId:"stage2b-paid-b",status:"paid",amount:87,currency:"JOD",paidAt:now,refundedAmount:0,
    createdAt:now,updatedAt:now
  });

  const rawBeforeA=await Payment.collection.findOne({_id:paymentA._id});
  const rawBeforeB=await Payment.collection.findOne({_id:paymentBId});
  assert.equal(Object.prototype.hasOwnProperty.call(rawBeforeB,"settlementRevision"),false,"fixture must prove a legacy Payment without settlementRevision");

  const preview=await previewPilotFinancialStage2b();
  assert.equal(preview.ok,true);
  assert.equal(preview.changesRequired,true);
  assert.equal(preview.alreadyCorrect,false);
  assert.deepEqual(preview.totals,{
    bookings:2,seats:6,grossAmount:137,currentCommission:0,correctCommission:30,commissionDelta:30,
    currentProviderNet:137,correctProviderNet:107,providerNetDelta:-30
  });

  const result=await applyPilotFinancialStage2b();
  assert.equal(result.applied,true);
  assert.equal(result.changedBookings,2);
  assert.equal(result.serializedPayments,2);
  assert.equal(result.restoredPayments,2);
  assert.equal(result.after.ok,true);
  assert.equal(result.after.alreadyCorrect,true);
  assert.equal(result.after.totals.currentCommission,30);
  assert.equal(result.after.totals.currentProviderNet,107);

  const repairedA=await Booking.findById(bookingA._id).lean();
  const repairedB=await Booking.findById(bookingB._id).lean();
  assert.equal(repairedA.pricing.grossAmount,50);
  assert.equal(repairedA.pricing.commissionAmount,10);
  assert.equal(repairedA.pricing.providerNetAmount,40);
  assert.equal(repairedB.pricing.grossAmount,87);
  assert.equal(repairedB.pricing.commissionAmount,20);
  assert.equal(repairedB.pricing.providerNetAmount,67);

  const rawAfterA=await Payment.collection.findOne({_id:paymentA._id});
  const rawAfterB=await Payment.collection.findOne({_id:paymentBId});
  assert.deepEqual(paymentSnapshot(rawAfterA),paymentSnapshot(rawBeforeA));
  assert.deepEqual(paymentSnapshot(rawAfterB),paymentSnapshot(rawBeforeB));
  assert.equal(await ProviderSettlement.countDocuments({}),0);

  const second=await applyPilotFinancialStage2b();
  assert.equal(second.applied,false);
  assert.equal(second.changedBookings,0);
  assert.equal(second.serializedPayments,0);
  assert.equal(second.restoredPayments,0);
  assert.equal(second.after.alreadyCorrect,true);
  assert.deepEqual(paymentSnapshot(await Payment.collection.findOne({_id:paymentA._id})),paymentSnapshot(rawBeforeA));
  assert.deepEqual(paymentSnapshot(await Payment.collection.findOne({_id:paymentBId})),paymentSnapshot(rawBeforeB));

  await Booking.updateOne({_id:bookingA._id},{$set:{"pricing.commissionAmount":0,"pricing.providerNetAmount":50}});
  await Booking.updateOne({_id:bookingB._id},{$set:{"pricing.commissionAmount":0,"pricing.providerNetAmount":87}});
  await ProviderSettlement.create({
    providerId:provider._id,
    items:[{paymentId:paymentA._id,bookingId:bookingA._id,grossSales:50,refunds:0,seaGoCommission:10,providerNet:40,amountPaid:40}],
    paymentIds:[paymentA._id],bookingIds:[bookingA._id],periodFrom:new Date(Date.now()-172800000),periodTo:new Date(),
    currency:"JOD",grossSales:50,refunds:0,seaGoCommission:10,providerNet:40,amountPaid:40,status:"paid",paidAt:new Date(),paidBy:admin._id
  });

  const blockedPreview=await previewPilotFinancialStage2b();
  assert.equal(blockedPreview.ok,false);
  assert.equal(blockedPreview.blockers.some(x=>x.code==="existing_settlement"),true);
  await assert.rejects(()=>applyPilotFinancialStage2b(),error=>error?.statusCode===409);
  const blockedA=await Booking.findById(bookingA._id).lean();
  const blockedB=await Booking.findById(bookingB._id).lean();
  assert.equal(blockedA.pricing.commissionAmount,0);
  assert.equal(blockedA.pricing.providerNetAmount,50);
  assert.equal(blockedB.pricing.commissionAmount,0);
  assert.equal(blockedB.pricing.providerNetAmount,87);
  assert.deepEqual(paymentSnapshot(await Payment.collection.findOne({_id:paymentA._id})),paymentSnapshot(rawBeforeA));
  assert.deepEqual(paymentSnapshot(await Payment.collection.findOne({_id:paymentBId})),paymentSnapshot(rawBeforeB));
});
