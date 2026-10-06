import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';
import Booking from '../src/models/Booking.js';
import Hold from '../src/models/CheckoutHold.js';
import Departure from '../src/models/Departure.js';
import Trip from '../src/models/Trip.js';
import Provider from '../src/models/Provider.js';
import User from '../src/models/User.js';
import Notice from '../src/models/InAppNotification.js';
import {processPaymentWebhook} from '../src/services/payments.js';
const uri=process.env.SEAGO_TEST_MONGODB_URI;
test('payment lifecycle on isolated MongoDB replica set',{skip:!uri},async t=>{
 assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/, 'Only a local disposable replica set is allowed');
 const saved={secret:process.env.MOCK_PAYMENT_WEBHOOK_SECRET,email:process.env.RESEND_API_KEY,push:process.env.VAPID_PUBLIC_KEY};
 process.env.MOCK_PAYMENT_WEBHOOK_SECRET='integration-only-webhook-key';delete process.env.RESEND_API_KEY;delete process.env.VAPID_PUBLIC_KEY;
 await mongoose.connect(uri,{dbName:'seago_payment_test_'+crypto.randomUUID().replaceAll('-','')});
 t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();for(const [key,v] of [['MOCK_PAYMENT_WEBHOOK_SECRET',saved.secret],['RESEND_API_KEY',saved.email],['VAPID_PUBLIC_KEY',saved.push]]){if(v===undefined)delete process.env[key];else process.env[key]=v}});
 await Promise.all([Payment,PaymentEvent,Booking,Hold,Departure,Trip,Provider,User,Notice].map(m=>m.init()));
 async function setup(){
  const user=await User.create({name:'Local test',phone:'+962790000000'});
  const provider=await Provider.create({ownerUserId:user._id,businessName:'Local test',status:'approved'});
  const pricing={currency:'JOD',pricePerPerson:20,adultPrice:20,commissionType:'fixed_per_person',commissionValue:4,grossAmount:20,commissionAmount:4,providerNetAmount:16};
  const trip=await Trip.create({providerId:provider._id,titleEn:'Local test',titleAr:'اختبار',category:'yacht',durationMinutes:60,active:true,pricing});
  const dep=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:2,reservedSeats:1,status:'scheduled'});
  const hold=await Hold.create({customerId:user._id,providerId:provider._id,tripId:trip._id,departureId:dep._id,seats:1,adults:1,pricing,idempotencyKey:crypto.randomUUID(),expiresAt:new Date(Date.now()+300000)});
  const payment=await Payment.create({holdId:hold._id,customerId:user._id,provider:'mock',externalPaymentId:crypto.randomUUID(),amount:20,currency:'JOD',status:'pending'});
  return{payment,hold,dep};
 }
 async function send(f,status,eventId=crypto.randomUUID(),amount=20){
  const rawBody=Buffer.from(JSON.stringify({eventId,externalPaymentId:f.payment.externalPaymentId,status,amount,currency:'JOD'}));
  return processPaymentWebhook({providerName:'mock',rawBody,signature:crypto.createHmac('sha256',process.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex')});
 }
 await t.test('normal paid creates one booking; same and new event IDs never duplicate it',async()=>{
  const f=await setup();const key=crypto.randomUUID();await send(f,'paid',key);await send(f,'paid',key);await send(f,'paid');await send(f,'failed');
  assert.equal((await Payment.findById(f.payment._id)).status,'paid');assert.equal(await Booking.countDocuments({departureId:f.dep._id}),1);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
 });
 for(const status of ['refunded','partially_refunded'])await t.test(`${status} survives a new paid event`,async()=>{
  const f=await setup();await send(f,'paid');await Payment.updateOne({_id:f.payment._id},{$set:{status,refundedAmount:status==='refunded'?20:10}});
  const before=await Notice.countDocuments();await send(f,'paid');await send(f,'failed');
  const p=await Payment.findById(f.payment._id);assert.equal(p.status,status);assert.equal(p.refundedAmount,status==='refunded'?20:10);assert.equal(await Notice.countDocuments(),before);
 });
 await t.test('late paid after failed is reviewed without rebooking or reserving seats',async()=>{
  const f=await setup();await send(f,'failed');await send(f,'paid');
  assert.equal((await Payment.findById(f.payment._id)).status,'needs_review');assert.equal(await Booking.countDocuments({departureId:f.dep._id}),0);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);
 });
 await t.test('concurrent paid and failed remain consistent',async()=>{
  for(let i=0;i<5;i++){
   const f=await setup();await Promise.all([send(f,'paid'),send(f,'failed')]);
   const p=await Payment.findById(f.payment._id),dep=await Departure.findById(f.dep._id),bookings=await Booking.countDocuments({departureId:f.dep._id});
   if(p.status==='paid'){assert.equal(bookings,1);assert.equal(dep.reservedSeats,1)}
   else{assert.equal(p.status,'needs_review');assert.equal(bookings,0);assert.equal(dep.reservedSeats,0)}
  }
 });
 await t.test('concurrent paid events create one booking and retain one seat',async()=>{
  const f=await setup();const key=crypto.randomUUID();await Promise.all([send(f,'paid',key),send(f,'paid',key),send(f,'paid')]);
  assert.equal((await Payment.findById(f.payment._id)).status,'paid');assert.equal(await Booking.countDocuments({departureId:f.dep._id}),1);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
 });
 await t.test('concurrent duplicate failures release seats once',async()=>{
  const f=await setup();await Promise.all([send(f,'failed'),send(f,'failed')]);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);assert.equal((await Payment.findById(f.payment._id)).status,'failed');
 });
 await t.test('inventory failure rolls back both hold and payment; retry succeeds',async sub=>{
  const f=await setup();const stub=sub.mock.method(Departure,'updateOne',async()=>{throw new Error('Injected inventory failure')});
  await assert.rejects(send(f,'failed'),/Injected/);stub.mock.restore();
  assert.equal((await Hold.findById(f.hold._id)).status,'active');assert.equal((await Payment.findById(f.payment._id)).status,'pending');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
  await send(f,'failed');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);
 });
 await t.test('wrong amount is reviewed without confirming a booking',async()=>{
  const f=await setup();await send(f,'paid',crypto.randomUUID(),19);assert.equal((await Payment.findById(f.payment._id)).status,'needs_review');assert.equal(await Booking.countDocuments({departureId:f.dep._id}),0);
 });
});
