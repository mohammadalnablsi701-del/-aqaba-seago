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
import { previewPilotFinancialStage2b } from "../src/services/pilotFinancialStage2b.js";
import { restorePilotFinancialStage2bPaymentRevisions } from "../src/services/pilotFinancialStage2bRevisionRestore.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

function paymentBusinessSnapshot(raw){
  return {
    bookingId:String(raw.bookingId),
    holdId:String(raw.holdId),
    customerId:String(raw.customerId),
    provider:raw.provider,
    externalPaymentId:raw.externalPaymentId,
    status:raw.status,
    amount:raw.amount,
    currency:raw.currency,
    refundedAmount:raw.refundedAmount,
    paidAt:raw.paidAt?.toISOString?.()||null,
    createdAt:raw.createdAt?.toISOString?.()||null,
    updatedAt:raw.updatedAt?.toISOString?.()||null
  };
}

function bookingSnapshot(raw){
  return {
    status:raw.status,
    seats:raw.seats,
    adults:raw.adults,
    children:raw.children,
    pricing:raw.pricing,
    checkedInAt:raw.checkedInAt||null,
    createdAt:raw.createdAt?.toISOString?.()||null,
    updatedAt:raw.updatedAt?.toISOString?.()||null
  };
}

test("Stage 2B remediation restores only accidental Payment revisions and blocks settled history",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"Only a local disposable replica set is allowed");
  await mongoose.connect(uri,{dbName:"seago_stage2b_revision_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
  await Promise.all([User,Provider,Trip,Departure,Booking,Payment,ProviderSettlement].map(model=>model.init()));

  const [owner,customer,admin]=await User.create([
    {name:"Fun Owner",email:"stage2b-revision-owner@example.test",role:"provider"},
    {name:"Customer",email:"stage2b-revision-customer@example.test",role:"customer"},
    {name:"Admin",email:"stage2b-revision-admin@example.test",role:"admin"}
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
      seats:2,adults:2,children:0,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:"stage2b-revision-a",
      pricing:{currency:"JOD",adultUnitPrice:25,adultSubtotal:50,childSubtotal:0,grossAmount:50,commissionAmount:10,providerNetAmount:40}
    },
    {
      customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,
      seats:4,adults:3,children:1,status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:"stage2b-revision-b",
      pricing:{currency:"JOD",adultUnitPrice:25,childUnitPrice:12,adultSubtotal:75,childSubtotal:12,grossAmount:87,commissionAmount:20,providerNetAmount:67}
    }
  ]);
  const now=new Date();
  const [paymentA,paymentB]=await Payment.create([
    {
      bookingId:bookingA._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:"mock",externalPaymentId:"stage2b-revision-paid-a",
      status:"paid",settlementRevision:1,amount:50,currency:"JOD",paidAt:now,refundedAmount:0
    },
    {
      bookingId:bookingB._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:"mock",externalPaymentId:"stage2b-revision-paid-b",
      status:"paid",settlementRevision:1,amount:87,currency:"JOD",paidAt:now,refundedAmount:0
    }
  ]);

  const paymentBeforeA=await Payment.collection.findOne({_id:paymentA._id});
  const paymentBeforeB=await Payment.collection.findOne({_id:paymentB._id});
  const bookingBeforeA=await Booking.collection.findOne({_id:bookingA._id});
  const bookingBeforeB=await Booking.collection.findOne({_id:bookingB._id});

  const preview=await previewPilotFinancialStage2b();
  assert.equal(preview.ok,true);
  assert.equal(preview.alreadyCorrect,true);
  assert.equal(preview.totals.currentCommission,30);
  assert.equal(preview.totals.currentProviderNet,107);
  assert.deepEqual(preview.rows.map(row=>row.settlementRevision),[1,1]);
  assert.equal(preview.settlementRecords.length,0);

  const restored=await restorePilotFinancialStage2bPaymentRevisions();
  assert.equal(restored.applied,true);
  assert.equal(restored.alreadyRestored,false);
  assert.equal(restored.restoredPayments,2);
  assert.equal(restored.after.alreadyCorrect,true);
  assert.equal(restored.after.totals.currentCommission,30);
  assert.equal(restored.after.totals.currentProviderNet,107);
  assert.deepEqual(restored.after.rows.map(row=>row.settlementRevision),[0,0]);
  assert.equal(restored.after.settlementRecords.length,0);

  const paymentAfterA=await Payment.collection.findOne({_id:paymentA._id});
  const paymentAfterB=await Payment.collection.findOne({_id:paymentB._id});
  assert.equal(paymentAfterA.settlementRevision,0);
  assert.equal(paymentAfterB.settlementRevision,0);
  assert.deepEqual(paymentBusinessSnapshot(paymentAfterA),paymentBusinessSnapshot(paymentBeforeA));
  assert.deepEqual(paymentBusinessSnapshot(paymentAfterB),paymentBusinessSnapshot(paymentBeforeB));
  assert.deepEqual(bookingSnapshot(await Booking.collection.findOne({_id:bookingA._id})),bookingSnapshot(bookingBeforeA));
  assert.deepEqual(bookingSnapshot(await Booking.collection.findOne({_id:bookingB._id})),bookingSnapshot(bookingBeforeB));

  const second=await restorePilotFinancialStage2bPaymentRevisions();
  assert.equal(second.applied,false);
  assert.equal(second.alreadyRestored,true);
  assert.equal(second.restoredPayments,0);
  assert.deepEqual(second.after.rows.map(row=>row.settlementRevision),[0,0]);

  await Payment.collection.updateMany({_id:{$in:[paymentA._id,paymentB._id]}},{$set:{settlementRevision:1}});
  await ProviderSettlement.create({
    providerId:provider._id,
    items:[{paymentId:paymentA._id,bookingId:bookingA._id,grossSales:50,refunds:0,seaGoCommission:10,providerNet:40,amountPaid:40}],
    paymentIds:[paymentA._id],bookingIds:[bookingA._id],periodFrom:new Date(Date.now()-172800000),periodTo:new Date(),
    currency:"JOD",grossSales:50,refunds:0,seaGoCommission:10,providerNet:40,amountPaid:40,status:"paid",paidAt:new Date(),paidBy:admin._id
  });

  await assert.rejects(()=>restorePilotFinancialStage2bPaymentRevisions(),error=>error?.statusCode===409);
  const blockedA=await Payment.collection.findOne({_id:paymentA._id});
  const blockedB=await Payment.collection.findOne({_id:paymentB._id});
  assert.equal(blockedA.settlementRevision,1);
  assert.equal(blockedB.settlementRevision,1);
  assert.deepEqual(bookingSnapshot(await Booking.collection.findOne({_id:bookingA._id})),bookingSnapshot(bookingBeforeA));
  assert.deepEqual(bookingSnapshot(await Booking.collection.findOne({_id:bookingB._id})),bookingSnapshot(bookingBeforeB));
});
