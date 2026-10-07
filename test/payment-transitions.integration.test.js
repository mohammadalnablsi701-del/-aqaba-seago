import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Settlement from '../src/models/ProviderSettlement.js';
import {settlementLedger,recordSettlement} from '../src/services/settlements.js';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';
import Booking from '../src/models/Booking.js';
import Hold from '../src/models/CheckoutHold.js';
import Departure from '../src/models/Departure.js';
import Trip from '../src/models/Trip.js';
import Provider from '../src/models/Provider.js';
import User from '../src/models/User.js';
import Notice from '../src/models/InAppNotification.js';
import {cancelBooking, cancelDepartureBookings} from '../src/services/cancellations.js';
import {releaseCheckoutHold} from '../src/services/inventory.js';
import {processPaymentWebhook, releaseExpiredCheckoutHolds} from '../src/services/payments.js';
const uri=process.env.SEAGO_TEST_MONGODB_URI;
test('payment lifecycle on isolated MongoDB replica set',{skip:!uri},async t=>{
 assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/, 'Only a local disposable replica set is allowed');
 const saved={secret:process.env.MOCK_PAYMENT_WEBHOOK_SECRET,email:process.env.RESEND_API_KEY,push:process.env.VAPID_PUBLIC_KEY};
 process.env.MOCK_PAYMENT_WEBHOOK_SECRET='integration-only-webhook-key';delete process.env.RESEND_API_KEY;delete process.env.VAPID_PUBLIC_KEY;
 await mongoose.connect(uri,{dbName:'seago_payment_test_'+crypto.randomUUID().replaceAll('-','')});
 t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();for(const [key,v] of [['MOCK_PAYMENT_WEBHOOK_SECRET',saved.secret],['RESEND_API_KEY',saved.email],['VAPID_PUBLIC_KEY',saved.push]]){if(v===undefined)delete process.env[key];else process.env[key]=v}});
 await Promise.all([Settlement,Payment,PaymentEvent,Booking,Hold,Departure,Trip,Provider,User,Notice].map(m=>m.init()));
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
 await t.test('expiry failure rolls back and concurrent retries release once',async sub=>{
  const f=await setup();await Hold.updateOne({_id:f.hold._id},{$set:{expiresAt:new Date(Date.now()-1000)}});
  const stub=sub.mock.method(Departure,'updateOne',async()=>{throw new Error('Injected expiry failure')});
  await assert.rejects(releaseExpiredCheckoutHolds(),/Injected/);stub.mock.restore();
  assert.equal((await Hold.findById(f.hold._id)).status,'active');assert.equal((await Payment.findById(f.payment._id)).status,'pending');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
  await Promise.all([releaseExpiredCheckoutHolds(),releaseExpiredCheckoutHolds()]);
  assert.equal((await Hold.findById(f.hold._id)).status,'expired');assert.equal((await Payment.findById(f.payment._id)).status,'expired');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);
 });
 await t.test('cleanup preserves a fresh hold while checkout has no payment yet',async()=>{
  const f=await setup();await Payment.deleteOne({_id:f.payment._id});await releaseExpiredCheckoutHolds();
  assert.equal((await Hold.findById(f.hold._id)).status,'active');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
 });
 await t.test('cleanup cannot release paid inventory even with an inconsistent active hold',async()=>{
  const f=await setup();await send(f,'paid');await Hold.updateOne({_id:f.hold._id},{$set:{status:'active'}});
  await assert.rejects(releaseCheckoutHold(f.hold._id),/reconciliation/);
  assert.equal((await Hold.findById(f.hold._id)).status,'active');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
 });
 await t.test('expiry racing payment failure never releases twice',async()=>{
  const f=await setup();await Hold.updateOne({_id:f.hold._id},{$set:{expiresAt:new Date(Date.now()-1000)}});
  await Promise.all([releaseExpiredCheckoutHolds(),send(f,'failed')]);
  assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);
 });
 async function confirmed(){const f=await setup();await send(f,'paid');f.booking=await Booking.findOne({departureId:f.dep._id});return f}
 const cancel=f=>cancelBooking({bookingId:f.booking._id,customerId:f.booking.customerId,source:'customer',forceFullRefund:true});
 await t.test('cancellation inventory failure rolls back refund and booking; duplicate retries are safe',async sub=>{
  const f=await confirmed();const stub=sub.mock.method(Departure,'updateOne',async()=>{throw new Error('Injected cancellation failure')});
  await assert.rejects(cancel(f),/Injected/);stub.mock.restore();
  assert.equal((await Booking.findById(f.booking._id)).status,'confirmed');assert.equal((await Payment.findById(f.payment._id)).status,'paid');assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
  const results=await Promise.all([cancel(f),cancel(f)]);await cancel(f);
  assert.equal(results[0].booking.cancellation.cancelledAt.getTime(),results[1].booking.cancellation.cancelledAt.getTime());
  const p=await Payment.findById(f.payment._id);assert.equal(p.status,'refunded');assert.equal(p.refundedAmount,20);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);
  await assert.rejects(cancelBooking({bookingId:f.booking._id,customerId:new mongoose.Types.ObjectId(),source:'customer'}),{statusCode:404});
 });
 await t.test('inconsistent inventory rejects cancellation without refunding payment',async()=>{
  const f=await confirmed();await Departure.updateOne({_id:f.dep._id},{$set:{reservedSeats:0}});
  await assert.rejects(cancel(f),{statusCode:409});assert.equal((await Payment.findById(f.payment._id)).status,'paid');assert.equal((await Booking.findById(f.booking._id)).status,'confirmed');
 });
 await t.test('customer cannot cancel an already used ticket',async()=>{
  const f=await confirmed();await Booking.updateOne({_id:f.booking._id},{$set:{checkedInAt:new Date()}});
  await assert.rejects(cancel(f),{statusCode:409});assert.equal((await Payment.findById(f.payment._id)).status,'paid');
 });
 await t.test('departure cancellation resumes remaining bookings after partial batch failure',async sub=>{
  const f=await confirmed();
  const hold=await Hold.create({...f.hold.toObject(),_id:new mongoose.Types.ObjectId(),idempotencyKey:crypto.randomUUID(),status:'active'});
  const payment=await Payment.create({holdId:hold._id,customerId:hold.customerId,provider:'mock',externalPaymentId:crypto.randomUUID(),amount:20,currency:'JOD',status:'pending'});
  await Departure.updateOne({_id:f.dep._id},{$inc:{reservedSeats:1}});await send({payment},'paid');
  const bookings=await Booking.find({departureId:f.dep._id}).sort({_id:1});
  const original=Departure.updateOne;let count=0;
  const stub=sub.mock.method(Departure,'updateOne',function(...args){if(++count===2)throw new Error('Injected second cancellation failure');return original.apply(this,args)});
  const args={departureId:f.dep._id,providerId:f.hold.providerId};
  await assert.rejects(cancelDepartureBookings(args),/Injected/);stub.mock.restore();
  assert.equal(await Booking.countDocuments({departureId:f.dep._id,status:'cancelled'}),1);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,1);
  await cancelDepartureBookings(args);await cancelDepartureBookings(args);
  assert.equal(await Booking.countDocuments({departureId:f.dep._id,status:'cancelled'}),2);assert.equal((await Departure.findById(f.dep._id)).reservedSeats,0);
  assert.equal((await Payment.find({bookingId:{$in:bookings.map(b=>b._id)}})).reduce((sum,p)=>sum+p.refundedAmount,0),40);
 });

 const period={from:new Date('2000-01-01'),to:new Date('2100-01-01')};
 const payout=f=>recordSettlement({...period,providerId:String(f.hold.providerId),paidBy:f.hold.customerId});
 const ledger=f=>settlementLedger({...period,providerId:String(f.hold.providerId)});
 await t.test('refund after payout preserves actual paid amount and exposes recoverable balance',async()=>{
  const f=await confirmed();const s=await payout(f);assert.equal(s.amountPaid,16);
  await cancel(f);const {breakdown:[row]}=await ledger(f);
  assert.equal(row.paid,16);assert.equal(row.providerNet,0);assert.equal(row.outstanding,-16);assert.equal(row.recoveryDue,16);
  assert.equal((await Settlement.findById(s._id)).amountPaid,16);
  await assert.rejects(payout(f),{statusCode:409});
 });
 await t.test('partial refund after payout keeps cash paid fixed',async()=>{
  const f=await confirmed();await payout(f);await Payment.updateOne({_id:f.payment._id},{$set:{status:'partially_refunded',refundedAmount:10}});
  const {breakdown:[row]}=await ledger(f);assert.equal(row.paid,16);assert.equal(row.providerNet,8);assert.equal(row.outstanding,-8);assert.equal(row.recoveryDue,8);
 });
 await t.test('refund before payout reduces only the new settlement snapshot',async()=>{
  const f=await confirmed();await Payment.updateOne({_id:f.payment._id},{$set:{status:'partially_refunded',refundedAmount:10}});
  const s=await payout(f);assert.equal(s.amountPaid,8);assert.equal(s.items[0].amountPaid,8);assert.equal(s.refunds,10);
  const {breakdown:[row]}=await ledger(f);assert.equal(row.paid,8);assert.equal(row.outstanding,0);
 });
 await t.test('concurrent payouts record payment only once',async()=>{
  const f=await confirmed();const results=await Promise.allSettled([payout(f),payout(f)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await Settlement.countDocuments({providerId:f.hold.providerId}),1);
 });
 await t.test('refund racing payout leaves a valid immutable cash ledger',async()=>{
  const f=await confirmed();await Promise.allSettled([payout(f),cancel(f)]);
  assert.equal((await Booking.findById(f.booking._id)).status,'cancelled');
  const {breakdown:[row]}=await ledger(f);const records=await Settlement.find({providerId:f.hold.providerId});
  assert.equal(row.paid,records.reduce((sum,s)=>sum+s.amountPaid,0));assert.equal(row.outstanding,0-row.paid);assert.equal(row.providerNet,0);
 });
 await t.test('legacy batch uses its stored total and refuses invented partial-period allocations',async()=>{
  const f=await confirmed(),g=await confirmed();await Booking.updateOne({_id:g.booking._id},{$set:{providerId:f.hold.providerId}});
  await Payment.updateOne({_id:f.payment._id},{$set:{paidAt:new Date('2026-01-01')}});await Payment.updateOne({_id:g.payment._id},{$set:{paidAt:new Date('2026-02-01')}});
  await Settlement.create({providerId:f.hold.providerId,paymentIds:[f.payment._id,g.payment._id],bookingIds:[f.booking._id,g.booking._id],periodFrom:period.from,periodTo:period.to,amountPaid:32,paidBy:f.hold.customerId});
  await cancel(f);const {breakdown:[row]}=await ledger(f);assert.equal(row.paid,32);assert.equal(row.recoveryDue,16);
  const partial=await settlementLedger({providerId:String(f.hold.providerId),from:new Date('2026-02-01'),to:new Date('2026-02-02')});
  assert.equal(partial.breakdown[0].reconciliationRequired,true);assert.equal(partial.breakdown[0].paid,null);
  await assert.rejects(recordSettlement({providerId:String(f.hold.providerId),paidBy:f.hold.customerId,from:new Date('2026-02-01'),to:new Date('2026-02-02')}),{statusCode:409});
 });
 await t.test('repeat-period settlement snapshots exclude previously paid bookings',async()=>{
  const f=await confirmed();await payout(f);const g=await confirmed();await Booking.updateOne({_id:g.booking._id},{$set:{providerId:f.hold.providerId}});
  const s=await payout(f);assert.equal(s.grossSales,20);assert.equal(s.providerNet,16);assert.equal(s.amountPaid,16);assert.equal(s.items.length,1);
  const {breakdown:[row]}=await ledger(f);assert.equal(row.paid,32);assert.equal(row.outstanding,0);
 });

});
