import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Booking from '../src/models/Booking.js';
import CheckoutHold from '../src/models/CheckoutHold.js';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const bookingRef=id=>'SG-'+String(id).slice(-8).toUpperCase();

test('admin payment operations are read-only, bounded, relation-aware and secret-safe',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='admin-payment-operations-test-secret-at-least-32-characters';
  await mongoose.connect(uri,{dbName:'seago_admin_payment_ops_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });
  await Promise.all([User,Provider,Trip,Departure,Booking,CheckoutHold,Payment,PaymentEvent].map(model=>model.init()));

  const admin=await User.create({name:'Payment Admin',email:'payment-admin@example.test',role:'admin'});
  const customer=await User.create({name:'Payment Customer',email:'payment-customer@example.test',phone:'0791234567',phoneNormalized:'+962791234567',role:'customer'});
  const providerUser=await User.create({name:'Payment Provider',email:'payment-provider@example.test',role:'provider'});
  const provider=await Provider.create({ownerUserId:providerUser._id,businessName:'Payment Marine',status:'approved',settings:{configured:true,defaultCapacity:20,defaultDepartureTime:'09:00'}});
  const trip=await Trip.create({providerId:provider._id,titleAr:'رحلة الدفع',titleEn:'Payment Trip',category:'group_boat',durationMinutes:120,pricing:{currency:'JOD',pricePerPerson:21,commissionType:'percentage',commissionValue:10},active:true,platformStatus:'allowed'});
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:30,reservedSeats:0,status:'scheduled'});

  const pricing={currency:'JOD',unitPrice:21,grossAmount:42,commissionAmount:4.2,providerNetAmount:37.8,adultUnitPrice:21,childUnitPrice:10,adultSubtotal:42,childSubtotal:0};
  let key=0;
  async function hold(amount=42,currency='JOD',status='paid'){
    key+=1;
    return CheckoutHold.create({customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:2,adults:2,children:0,mealPlan:'without_buffet',pricing:{...pricing,grossAmount:amount,currency},status,expiresAt:new Date(Date.now()+3600000),idempotencyKey:`payment-ops-hold-${key}`});
  }
  async function booking(status='confirmed',amount=42,currency='JOD'){
    key+=1;
    return Booking.create({customerId:customer._id,customerSnapshot:{name:'Snapshot Payment Customer',phone:'+962791234567'},providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:2,adults:2,children:0,status,holdExpiresAt:new Date(Date.now()+3600000),pricing:{...pricing,grossAmount:amount,currency},idempotencyKey:`payment-ops-booking-${key}`});
  }
  async function payment({status='paid',externalPaymentId,bookingDoc=null,holdDoc=null,amount=42,currency='JOD',refundedAmount=0,refundReference=null,rawSecret='RAW_PAYMENT_SECRET'}){
    return Payment.create({bookingId:bookingDoc?._id,holdId:holdDoc?._id||new mongoose.Types.ObjectId(),customerId:customer._id,provider:'mock',externalPaymentId,status,amount,currency,refundedAmount,refundReference,refundedAt:refundedAmount?new Date():undefined,checkoutUrl:'https://gateway.example.test/checkout?secret=CHECKOUT_SECRET',lastEventId:'evt_private_internal',rawLastEvent:{signature:'SIGNATURE_SECRET',authorization:rawSecret}});
  }

  const paidBooking=await booking('confirmed');
  const paidHold=await hold();
  const paid=await payment({status:'paid',externalPaymentId:'ext_paid_visibility_001',bookingDoc:paidBooking,holdDoc:paidHold});
  await PaymentEvent.create({provider:'mock',eventId:'evt_paid_visibility_001',externalPaymentId:paid.externalPaymentId,paymentId:paid._id,eventStatus:'paid',amount:42,currency:'JOD',raw:{signature:'EVENT_SIGNATURE_SECRET',authorization:'EVENT_AUTH_SECRET'},processedAt:new Date()});

  const reviewBooking=await booking('confirmed');
  const reviewHold=await hold();
  const review=await payment({status:'needs_review',externalPaymentId:'ext_review_visibility_001',bookingDoc:reviewBooking,holdDoc:reviewHold});

  const noBookingHold=await hold();
  const paidNoBooking=await payment({status:'paid',externalPaymentId:'ext_paid_no_booking',holdDoc:noBookingHold});

  const confirmedPendingBooking=await booking('confirmed');
  const confirmedPendingHold=await hold(42,'JOD','active');
  const confirmedPending=await payment({status:'pending',externalPaymentId:'ext_confirmed_pending',bookingDoc:confirmedPendingBooking,holdDoc:confirmedPendingHold});

  const partialBooking=await booking('cancelled');
  const partialHold=await hold();
  const partial=await payment({status:'partially_refunded',externalPaymentId:'ext_partial',bookingDoc:partialBooking,holdDoc:partialHold,refundedAmount:10,refundReference:'refund_partial_001'});

  const refundedBooking=await booking('refunded');
  const refundedHold=await hold();
  const refunded=await payment({status:'refunded',externalPaymentId:'ext_refunded',bookingDoc:refundedBooking,holdDoc:refundedHold,refundedAmount:42,refundReference:'refund_full_001'});

  const mismatchBooking=await booking('confirmed',40,'USD');
  const mismatchHold=await hold();
  const mismatch=await payment({status:'needs_review',externalPaymentId:'ext_mismatch',bookingDoc:mismatchBooking,holdDoc:mismatchHold,amount:42,currency:'JOD'});

  const missingHold=await payment({status:'paid',externalPaymentId:'ext_missing_hold'});

  const tokenFor=user=>jwt.sign({sub:String(user._id),ver:user.authVersion||0},process.env.JWT_SECRET,{expiresIn:'1h'});
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const endpoint=`${base}/api/admin/payments`;
  const adminHeaders={authorization:`Bearer ${tokenFor(admin)}`};

  // A/O) list and detail are admin-only.
  assert.equal((await fetch(endpoint)).status,401);
  assert.equal((await fetch(endpoint,{headers:{authorization:`Bearer ${tokenFor(customer)}`}})).status,403);
  assert.equal((await fetch(endpoint,{headers:{authorization:`Bearer ${tokenFor(providerUser)}`}})).status,403);
  assert.equal((await fetch(`${endpoint}/${paid._id}`)).status,401);
  assert.equal((await fetch(`${endpoint}/${paid._id}`,{headers:{authorization:`Bearer ${tokenFor(customer)}`}})).status,403);

  const listResponse=await fetch(endpoint,{headers:adminHeaders});
  assert.equal(listResponse.status,200);
  const list=await listResponse.json();
  assert.ok(list.items.length>=8);
  assert.equal(list.pagination.limit,25);
  assert.equal(list.pagination.page,1);
  assert.ok(list.items.every(item=>item.gateway==='mock'));
  assert.ok(list.items.every(item=>item.customer&&Object.keys(item.customer).join(',')==='name'));

  // B/C/D) exact filters and external ID search.
  const paidOnly=await (await fetch(`${endpoint}?status=paid`,{headers:adminHeaders})).json();
  assert.ok(paidOnly.items.length>=2);
  assert.ok(paidOnly.items.every(item=>item.status==='paid'));
  const reviewOnly=await (await fetch(`${endpoint}?needsReview=true`,{headers:adminHeaders})).json();
  assert.ok(reviewOnly.items.length>=2);
  assert.ok(reviewOnly.items.every(item=>item.status==='needs_review'));
  const exactExternal=await (await fetch(`${endpoint}?q=ext_paid_visibility_001`,{headers:adminHeaders})).json();
  assert.equal(exactExternal.items.length,1);
  assert.equal(exactExternal.items[0].id,String(paid._id));
  const exactInternal=await (await fetch(`${endpoint}?q=${paid._id}`,{headers:adminHeaders})).json();
  assert.equal(exactInternal.items.length,1);
  assert.equal(exactInternal.items[0].externalPaymentId,'ext_paid_visibility_001');
  const exactBooking=await (await fetch(`${endpoint}?q=${bookingRef(paidBooking._id)}`,{headers:adminHeaders})).json();
  assert.equal(exactBooking.items.length,1);
  assert.equal(exactBooking.items[0].booking.reference,bookingRef(paidBooking._id));

  // E/F/G/H/I) relations and operational warnings are current-state diagnostics.
  const linkedItem=list.items.find(item=>item.id===String(paid._id));
  assert.equal(linkedItem.booking.reference,bookingRef(paidBooking._id));
  assert.equal(linkedItem.businessProvider.businessName,'Payment Marine');
  const noBookingDetail=await (await fetch(`${endpoint}/${paidNoBooking._id}`,{headers:adminHeaders})).json();
  assert.equal(noBookingDetail.booking,null);
  assert.ok(noBookingDetail.review.warnings.some(w=>w.code==='paid_without_booking'));
  const pendingDetail=await (await fetch(`${endpoint}/${confirmedPending._id}`,{headers:adminHeaders})).json();
  assert.ok(pendingDetail.review.warnings.some(w=>w.code==='confirmed_booking_non_success_payment'));
  const reviewDetail=await (await fetch(`${endpoint}/${review._id}`,{headers:adminHeaders})).json();
  assert.equal(reviewDetail.review.needsReview,true);
  assert.ok(reviewDetail.review.warnings.some(w=>w.code==='needs_review'));
  const mismatchDetail=await (await fetch(`${endpoint}/${mismatch._id}`,{headers:adminHeaders})).json();
  assert.ok(mismatchDetail.review.warnings.some(w=>w.code==='amount_mismatch'));
  assert.ok(mismatchDetail.review.warnings.some(w=>w.code==='currency_mismatch'));
  const missingHoldDetail=await (await fetch(`${endpoint}/${missingHold._id}`,{headers:adminHeaders})).json();
  assert.equal(missingHoldDetail.checkoutHold,null);
  assert.ok(missingHoldDetail.review.warnings.some(w=>w.code==='missing_checkout_hold'));

  // J/K/L) partial/full refund truth and references remain visible without controls.
  const partialDetail=await (await fetch(`${endpoint}/${partial._id}`,{headers:adminHeaders})).json();
  assert.equal(partialDetail.payment.status,'partially_refunded');
  assert.equal(partialDetail.refund.state,'partially_refunded');
  assert.equal(partialDetail.refund.amount,10);
  assert.equal(partialDetail.refund.reference,'refund_partial_001');
  const refundedDetail=await (await fetch(`${endpoint}/${refunded._id}`,{headers:adminHeaders})).json();
  assert.equal(refundedDetail.payment.status,'refunded');
  assert.equal(refundedDetail.refund.state,'refunded');
  assert.equal(refundedDetail.refund.amount,42);
  assert.equal(refundedDetail.refund.reference,'refund_full_001');

  // M/N) safe event metadata is useful while raw payment/webhook secrets never leave the DTO.
  const paidDetail=await (await fetch(`${endpoint}/${paid._id}`,{headers:adminHeaders})).json();
  assert.equal(paidDetail.events.length,1);
  assert.equal(paidDetail.events[0].eventId,'evt_paid_visibility_001');
  assert.equal(paidDetail.events[0].status,'paid');
  assert.equal(paidDetail.eventVisibility.rawPayloadExposed,false);
  assert.equal(paidDetail.eventVisibility.duplicateReplayPersisted,false);
  const serialized=JSON.stringify({list,paidDetail,reviewDetail});
  assert.doesNotMatch(serialized,/CHECKOUT_SECRET|RAW_PAYMENT_SECRET|SIGNATURE_SECRET|EVENT_SIGNATURE_SECRET|EVENT_AUTH_SECRET|evt_private_internal/);
  assert.doesNotMatch(serialized,/checkoutUrl|rawLastEvent|"raw"|authorization|signature/i);

  // P) pagination/query work is explicitly bounded and unsafe query shapes are rejected.
  assert.equal((await fetch(`${endpoint}?limit=51`,{headers:adminHeaders})).status,400);
  assert.equal((await fetch(`${endpoint}?page=10001`,{headers:adminHeaders})).status,400);
  assert.equal((await fetch(`${endpoint}?q=${'x'.repeat(121)}`,{headers:adminHeaders})).status,400);
  assert.equal((await fetch(`${endpoint}?status[$ne]=paid`,{headers:adminHeaders})).status,400);
  const pageOne=await (await fetch(`${endpoint}?limit=2&page=1`,{headers:adminHeaders})).json();
  assert.equal(pageOne.items.length,2);
  assert.equal(pageOne.pagination.limit,2);
  assert.equal(pageOne.pagination.hasNext,true);

  // This task adds no payment mutation endpoint.
  assert.equal((await fetch(`${endpoint}/${paid._id}`,{method:'PATCH',headers:{...adminHeaders,'content-type':'application/json'},body:JSON.stringify({status:'paid'})})).status,404);
  assert.equal((await fetch(`${endpoint}/${paid._id}/refund`,{method:'POST',headers:adminHeaders})).status,404);
});
