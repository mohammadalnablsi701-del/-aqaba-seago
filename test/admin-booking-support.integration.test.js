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
import Payment from '../src/models/Payment.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const bookingRef=id=>'SG-'+String(id).slice(-8).toUpperCase();

test('admin booking support search/detail are read-only, bounded, role-safe and secret-safe',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  const oldTicketSecret=process.env.TICKET_SIGNING_SECRET;
  process.env.JWT_SECRET='admin-booking-support-test-secret-at-least-32-characters';
  process.env.TICKET_SIGNING_SECRET='admin-booking-support-ticket-secret-at-least-32-characters';

  await mongoose.connect(uri,{dbName:'seago_admin_booking_support_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldTicketSecret===undefined)delete process.env.TICKET_SIGNING_SECRET;else process.env.TICKET_SIGNING_SECRET=oldTicketSecret;
  });
  await Promise.all([User,Provider,Trip,Departure,Booking,Payment].map(model=>model.init()));

  const admin=await User.create({name:'Support Admin',email:'admin-support@example.test',phone:'+962790001001',phoneNormalized:'+962790001001',role:'admin'});
  const customer=await User.create({name:'Support Customer',email:'customer-support@example.test',phone:'0790001002',phoneNormalized:'+962790001002',role:'customer'});
  const providerUser=await User.create({name:'Provider Scanner',email:'provider-support@example.test',phone:'+962790001003',phoneNormalized:'+962790001003',role:'provider'});
  const otherCustomer=await User.create({name:'Other Customer',email:'other-customer@example.test',phone:'+962790001004',phoneNormalized:'+962790001004',role:'customer'});

  const provider=await Provider.create({ownerUserId:providerUser._id,businessName:'Historical Marine',status:'suspended',settings:{configured:true,defaultCapacity:20,defaultDepartureTime:'09:00',departureLocation:{name:'Aqaba Gate',address:'South Beach',googleMapsUrl:'https://maps.example.test/gate'}}});
  const trip=await Trip.create({providerId:provider._id,titleAr:'رحلة تاريخية',titleEn:'Historical Trip',vesselName:'Sea Truth',category:'group_boat',durationMinutes:120,pricing:{currency:'JOD',pricePerPerson:99,commissionType:'percentage',commissionValue:50},departureLocation:{name:'Trip Pier',address:'Pier 7'},active:false,platformStatus:'paused'});
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:30,reservedSeats:12,salesClosed:true,status:'scheduled'});

  const pricingSnapshot={currency:'JOD',unitPrice:21,grossAmount:42,commissionAmount:8.4,providerNetAmount:33.6,adultUnitPrice:21,childUnitPrice:10,adultSubtotal:42,childSubtotal:0};
  const checkedAt=new Date(Date.now()-60000);
  const baseBooking=await Booking.create({
    customerId:customer._id,customerSnapshot:{name:'Snapshot Customer',phone:'+962790001002'},providerId:provider._id,tripId:trip._id,departureId:departure._id,
    seats:2,adults:2,children:0,mealPlan:'with_buffet',status:'confirmed',holdExpiresAt:new Date(Date.now()+3600000),pricing:pricingSnapshot,
    idempotencyKey:'support-base',checkedInAt:checkedAt,checkedInBy:providerUser._id,checkInCount:1
  });
  const checkoutSecret='https://gateway.example.test/pay?token=CHECKOUT_SECRET_DO_NOT_LEAK';
  const webhookSecret='RAW_WEBHOOK_AUTHORIZATION_DO_NOT_LEAK';
  await Payment.create({
    bookingId:baseBooking._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:'mock',externalPaymentId:'pay_support_001',status:'paid',amount:42,currency:'JOD',paidAt:new Date(),
    checkoutUrl:checkoutSecret,lastEventId:'evt_secret_internal',rawLastEvent:{authorization:webhookSecret,signature:'HMAC_DO_NOT_LEAK'}
  });

  const needsReviewBooking=await Booking.create({
    customerId:customer._id,customerSnapshot:{name:'Snapshot Customer',phone:'+962790001002'},providerId:provider._id,tripId:trip._id,departureId:departure._id,
    seats:1,adults:1,status:'confirmed',holdExpiresAt:new Date(Date.now()+3600000),pricing:{...pricingSnapshot,grossAmount:21,commissionAmount:4.2,providerNetAmount:16.8},idempotencyKey:'support-needs-review'
  });
  await Payment.create({bookingId:needsReviewBooking._id,holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:'real-gateway',externalPaymentId:'pay_needs_review_001',status:'needs_review',amount:21,currency:'JOD',checkoutUrl:'https://gateway.example.test/secret-review',rawLastEvent:{secret:'NEEDS_REVIEW_RAW_SECRET'}});

  const missingPaymentBooking=await Booking.create({
    customerId:otherCustomer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,status:'confirmed',holdExpiresAt:new Date(Date.now()+3600000),pricing:{...pricingSnapshot,grossAmount:21},idempotencyKey:'support-missing-payment'
  });

  const cancelledBooking=await Booking.create({
    customerId:otherCustomer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:2,adults:2,status:'cancelled',holdExpiresAt:new Date(Date.now()+3600000),pricing:pricingSnapshot,idempotencyKey:'support-cancelled',
    cancellation:{source:'customer',reason:'Weather concern',cancelledAt:new Date(Date.now()-120000),hoursBeforeDeparture:30,refundPercentage:50,refundAmount:21,refundStatus:'processed'}
  });
  await Payment.create({bookingId:cancelledBooking._id,holdId:new mongoose.Types.ObjectId(),customerId:otherCustomer._id,provider:'mock',externalPaymentId:'pay_cancelled_001',status:'partially_refunded',amount:42,currency:'JOD',refundedAmount:21,refundedAt:new Date(),refundReference:'refund_support_001'});

  const pendingBooking=await Booking.create({
    customerId:otherCustomer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,status:'pending_payment',holdExpiresAt:new Date(Date.now()+3600000),pricing:{...pricingSnapshot,grossAmount:21},idempotencyKey:'support-pending'
  });

  for(let index=0;index<26;index+=1){
    await Booking.create({
      customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,status:'confirmed',holdExpiresAt:new Date(Date.now()+3600000),
      pricing:{...pricingSnapshot,grossAmount:20+index},idempotencyKey:`support-bounded-${index}`
    });
  }

  const tokenFor=user=>jwt.sign({sub:String(user._id),ver:user.authVersion||0},process.env.JWT_SECRET,{expiresIn:'1h'});
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=`http://127.0.0.1:${port}`;
  const searchUrl=`${base}/api/admin/bookings/search`;
  const adminHeaders={authorization:`Bearer ${tokenFor(admin)}`};

  // N) admin only: unauthenticated/customer/provider are forbidden.
  assert.equal((await fetch(`${searchUrl}?q=${encodeURIComponent(bookingRef(baseBooking._id))}`)).status,401);
  assert.equal((await fetch(`${searchUrl}?q=${encodeURIComponent(bookingRef(baseBooking._id))}`,{headers:{authorization:`Bearer ${tokenFor(customer)}`}})).status,403);
  assert.equal((await fetch(`${searchUrl}?q=${encodeURIComponent(bookingRef(baseBooking._id))}`,{headers:{authorization:`Bearer ${tokenFor(providerUser)}`}})).status,403);

  // A) exact booking reference.
  const byReferenceResponse=await fetch(`${searchUrl}?q=${encodeURIComponent(bookingRef(baseBooking._id))}`,{headers:adminHeaders});
  assert.equal(byReferenceResponse.status,200);
  const byReference=await byReferenceResponse.json();
  assert.equal(byReference.items.length,1);
  assert.equal(byReference.items[0].bookingId,String(baseBooking._id));
  assert.equal(byReference.items[0].bookingReference,bookingRef(baseBooking._id));
  assert.equal(byReference.items[0].paymentStatus,'paid');
  assert.equal(byReference.items[0].total,42);
  assert.equal(byReference.items[0].providerName,'Historical Marine');
  assert.equal(byReference.items[0].tripTitle,'Historical Trip');
  assert.equal(byReference.items[0].customerName,'Snapshot Customer');
  assert.equal(byReference.items[0].customerEmail,undefined);
  assert.equal(byReference.items[0].customerPhone,undefined);

  // B/C/D) normalized email/phone and bounded multiple results.
  const byEmail=await (await fetch(`${searchUrl}?q=${encodeURIComponent('CUSTOMER-SUPPORT@EXAMPLE.TEST')}&limit=5`,{headers:adminHeaders})).json();
  assert.equal(byEmail.items.length,5);
  assert.equal(byEmail.truncated,true);
  assert.ok(byEmail.items.every(item=>!('email' in item)&&!('phone' in item)));

  const byPhone=await (await fetch(`${searchUrl}?q=${encodeURIComponent('0790001002')}&limit=5`,{headers:adminHeaders})).json();
  assert.equal(byPhone.items.length,5);
  assert.equal(byPhone.truncated,true);

  const byPaymentReference=await (await fetch(`${searchUrl}?q=pay_support_001`,{headers:adminHeaders})).json();
  assert.equal(byPaymentReference.items.length,1);
  assert.equal(byPaymentReference.items[0].bookingId,String(baseBooking._id));

  // O) query shape/length/limit cannot become Mongo operators or unbounded work.
  assert.equal((await fetch(`${searchUrl}?q%5B%24ne%5D=x`,{headers:adminHeaders})).status,400);
  assert.equal((await fetch(`${searchUrl}?q=${'x'.repeat(121)}`,{headers:adminHeaders})).status,400);
  assert.equal((await fetch(`${searchUrl}?q=x&limit=1000`,{headers:adminHeaders})).status,400);
  const literalInjection=await fetch(`${searchUrl}?q=${encodeURIComponent('{"$ne":""}')}`,{headers:adminHeaders});
  assert.equal(literalInjection.status,200);
  assert.deepEqual((await literalInjection.json()).items,[]);

  // E/F/G/I/J/P) linked truth, snapshot finance, historical visibility, check-in, safe allowlists.
  const detailResponse=await fetch(`${base}/api/admin/bookings/${baseBooking._id}`,{headers:adminHeaders});
  assert.equal(detailResponse.status,200);
  const detail=await detailResponse.json();
  assert.equal(detail.booking.reference,bookingRef(baseBooking._id));
  assert.equal(detail.booking.status,'confirmed');
  assert.equal(detail.booking.pricingSnapshot.grossAmount,42);
  assert.equal(detail.booking.pricingSnapshot.commissionAmount,8.4);
  assert.equal(detail.booking.pricingSnapshot.providerNetAmount,33.6);
  assert.equal(detail.customer.name,'Snapshot Customer');
  assert.equal(detail.customer.email,'customer-support@example.test');
  assert.equal(detail.customer.phone,'+962790001002');
  assert.equal(detail.provider.businessName,'Historical Marine');
  assert.equal(detail.provider.status,'suspended');
  assert.equal(detail.trip.title,'Historical Trip');
  assert.equal(detail.trip.vesselName,'Sea Truth');
  assert.equal(detail.trip.providerActive,false);
  assert.equal(detail.trip.platformStatus,'paused');
  assert.equal(detail.departure.capacity,30);
  assert.equal(detail.departure.reservedSeats,12);
  assert.equal(detail.departure.salesClosed,true);
  assert.equal(detail.departure.point.name,'Trip Pier');
  assert.equal(detail.payment.gateway,'mock');
  assert.equal(detail.payment.status,'paid');
  assert.equal(detail.payment.amount,42);
  assert.equal(detail.payment.externalPaymentId,'pay_support_001');
  assert.equal(detail.ticket.source,'booking_derived');
  assert.equal(detail.ticket.persistedRecord,false);
  assert.equal(detail.ticket.available,true);
  assert.equal(detail.ticket.status,'used');
  assert.equal(detail.ticket.used,true);
  assert.equal(detail.checkIn.level,'booking');
  assert.equal(detail.checkIn.checkedIn,true);
  assert.equal(new Date(detail.checkIn.checkedInAt).getTime(),checkedAt.getTime());
  assert.equal(detail.checkIn.checkedInBy.name,'Provider Scanner');
  assert.equal(detail.checkIn.checkedInBy.role,'provider');
  assert.equal(detail.booking.currentTripPricing,undefined);

  const serialized=JSON.stringify(detail);
  assert.doesNotMatch(serialized,/CHECKOUT_SECRET_DO_NOT_LEAK|RAW_WEBHOOK_AUTHORIZATION_DO_NOT_LEAK|HMAC_DO_NOT_LEAK|evt_secret_internal|rawLastEvent|checkoutUrl|lastEventId/);
  assert.doesNotMatch(serialized,/passwordHash|authVersion|ticketToken|ticketValidationUrl|authorization|signature/i);

  // H) cancellation and refund snapshot fields.
  const cancelled=await (await fetch(`${base}/api/admin/bookings/${cancelledBooking._id}`,{headers:adminHeaders})).json();
  assert.equal(cancelled.cancellation.source,'customer');
  assert.equal(cancelled.cancellation.reason,'Weather concern');
  assert.equal(cancelled.cancellation.refundPercentage,50);
  assert.equal(cancelled.cancellation.refundAmount,21);
  assert.equal(cancelled.cancellation.refundStatus,'processed');
  assert.equal(cancelled.cancellation.retainedAmount,21);
  assert.equal(cancelled.payment.status,'partially_refunded');
  assert.equal(cancelled.payment.refundedAmount,21);
  assert.equal(cancelled.payment.refundReference,'refund_support_001');

  // K) confirmed missing payment is an operational warning, not a server error.
  const missingPayment=await (await fetch(`${base}/api/admin/bookings/${missingPaymentBooking._id}`,{headers:adminHeaders})).json();
  assert.equal(missingPayment.payment,null);
  assert.ok(missingPayment.warnings.some(warning=>warning.code==='confirmed_missing_payment'));

  // L) unavailable ticket state is explicit and secret-free when the booking is not ticket-eligible.
  const pending=await (await fetch(`${base}/api/admin/bookings/${pendingBooking._id}`,{headers:adminHeaders})).json();
  assert.equal(pending.ticket.available,false);
  assert.equal(pending.ticket.status,'unavailable');

  // M) needs_review is highly visible but remains read-only.
  const needsReview=await (await fetch(`${base}/api/admin/bookings/${needsReviewBooking._id}`,{headers:adminHeaders})).json();
  assert.equal(needsReview.payment.status,'needs_review');
  assert.equal(needsReview.payment.needsReview,true);
  assert.equal(needsReview.payment.diagnosticSummary,'Payment requires operations review.');
  assert.ok(needsReview.warnings.some(warning=>warning.code==='payment_needs_review'));
  assert.doesNotMatch(JSON.stringify(needsReview),/NEEDS_REVIEW_RAW_SECRET|secret-review/);

  // Detail is protected too and no mutation method was added at this route.
  assert.equal((await fetch(`${base}/api/admin/bookings/${baseBooking._id}`)).status,401);
  assert.equal((await fetch(`${base}/api/admin/bookings/${baseBooking._id}`,{headers:{authorization:`Bearer ${tokenFor(customer)}`}})).status,403);
  const forbiddenMutation=await fetch(`${base}/api/admin/bookings/${baseBooking._id}`,{method:'PATCH',headers:{...adminHeaders,'content-type':'application/json'},body:JSON.stringify({status:'cancelled'})});
  assert.equal(forbiddenMutation.status,404);
  const unchanged=await Booking.findById(baseBooking._id).lean();
  assert.equal(unchanged.status,'confirmed');
});
