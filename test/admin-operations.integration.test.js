import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import User from '../src/models/User.js';
import Payment from '../src/models/Payment.js';
import NotificationLog from '../src/models/NotificationLog.js';
import SupportRequest from '../src/models/SupportRequest.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Booking from '../src/models/Booking.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

function ammanYmd(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const part=type=>parts.find(item=>item.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function shiftYmd(value,days){
  const [y,m,d]=value.split('-').map(Number);
  const date=new Date(Date.UTC(y,m-1,d));
  date.setUTCDate(date.getUTCDate()+days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}

test('admin operations queue is protected and global departures expose safe daily operations truth',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='admin-operations-test-secret-at-least-32-characters';

  await mongoose.connect(uri,{dbName:'seago_admin_ops_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });

  await Promise.all([User,Payment,NotificationLog,SupportRequest,Provider,Trip,Departure,Booking].map(m=>m.init()));

  const admin=await User.create({name:'Admin',phone:'+962790009001',role:'admin'});
  const customer=await User.create({name:'Customer Secret Name',email:'customer-secret@example.test',phone:'+962790009002',role:'customer'});
  const provider=await User.create({name:'Provider A User',phone:'+962790009003',role:'provider'});
  const providerUserB=await User.create({name:'Provider B User',phone:'+962790009004',role:'provider'});
  const suspendedProviderUser=await User.create({name:'Suspended Provider User',phone:'+962790009005',role:'provider'});

  const rawSecret='raw-webhook-secret-must-not-leak';
  const checkoutSecret='https://gateway.example.test/pay?token=checkout-secret-must-not-leak';
  const notificationRecipient='private-recipient@example.test';
  const notificationExternalId='provider-message-secret-id';
  const supportMessage='support-message-body-must-not-appear-in-attention-preview';
  await Payment.create({
    holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:'mock',status:'needs_review',amount:42,currency:'JOD',
    checkoutUrl:checkoutSecret,rawLastEvent:{authorization:rawSecret}
  });
  await NotificationLog.create({
    key:'ops-test-failure',type:'booking_confirmation',recipient:notificationRecipient,status:'failed',externalId:notificationExternalId,error:'x'.repeat(400)
  });
  await SupportRequest.create({customerId:customer._id,subject:'Need help',message:supportMessage,status:'open',bookingReference:'SG-TEST1234'});

  const providerA=await Provider.create({ownerUserId:provider._id,businessName:'Alpha Marine',status:'approved'});
  const providerB=await Provider.create({ownerUserId:providerUserB._id,businessName:'Bravo Boats',status:'approved'});
  const providerSuspended=await Provider.create({ownerUserId:suspendedProviderUser._id,businessName:'Suspended Sea',status:'suspended'});
  const pricing={pricePerPerson:20,commissionType:'percentage',commissionValue:20};
  const tripA=await Trip.create({providerId:providerA._id,titleAr:'ألفا',titleEn:'Alpha Trip',vesselName:'Alpha One',category:'group_boat',durationMinutes:120,pricing,active:true,platformStatus:'allowed'});
  const tripB=await Trip.create({providerId:providerB._id,titleAr:'برافو',titleEn:'Bravo Trip',vesselName:'Bravo One',category:'group_boat',durationMinutes:120,pricing,active:true,platformStatus:'allowed'});
  const platformPausedTrip=await Trip.create({providerId:providerA._id,titleAr:'متوقفة منصة',titleEn:'Platform Paused',vesselName:'Pause Platform',category:'group_boat',durationMinutes:120,pricing,active:true,platformStatus:'paused'});
  const providerPausedTrip=await Trip.create({providerId:providerA._id,titleAr:'متوقفة مزود',titleEn:'Provider Paused',vesselName:'Pause Provider',category:'group_boat',durationMinutes:120,pricing,active:false,platformStatus:'allowed'});
  const suspendedTrip=await Trip.create({providerId:providerSuspended._id,titleAr:'معلق',titleEn:'Suspended Provider Trip',vesselName:'Suspended One',category:'group_boat',durationMinutes:120,pricing,active:true,platformStatus:'allowed'});

  const today=ammanYmd();
  const tomorrow=shiftYmd(today,1);
  const emptyDay=shiftYmd(today,2);
  const at=(day,time)=>new Date(`${day}T${time}:00.000+03:00`);
  const depA=await Departure.create({tripId:tripA._id,startsAt:at(today,'09:00'),capacity:10,reservedSeats:5,status:'scheduled',salesClosed:false});
  const depB=await Departure.create({tripId:tripB._id,startsAt:at(today,'11:00'),capacity:20,reservedSeats:0,status:'scheduled',salesClosed:false});
  const depPlatformPaused=await Departure.create({tripId:platformPausedTrip._id,startsAt:at(today,'12:00'),capacity:8,reservedSeats:1,status:'scheduled',salesClosed:false});
  const depProviderPaused=await Departure.create({tripId:providerPausedTrip._id,startsAt:at(today,'13:00'),capacity:7,reservedSeats:2,status:'scheduled',salesClosed:false});
  const depSuspended=await Departure.create({tripId:suspendedTrip._id,startsAt:at(today,'14:00'),capacity:9,reservedSeats:3,status:'scheduled',salesClosed:false});
  const depCancelled=await Departure.create({tripId:tripB._id,startsAt:at(today,'15:00'),capacity:10,reservedSeats:4,status:'cancelled',salesClosed:true});
  await Departure.create({tripId:tripA._id,startsAt:at(tomorrow,'09:00'),capacity:10,reservedSeats:0,status:'scheduled',salesClosed:false});

  const bookingBase={customerId:customer._id,providerId:providerA._id,tripId:tripA._id,departureId:depA._id,status:'confirmed',holdExpiresAt:new Date(Date.now()+3600000)};
  await Booking.create({...bookingBase,seats:2,adults:2,idempotencyKey:'ops-checked',checkedInAt:new Date(),checkedInBy:provider._id,checkInCount:1,customerSnapshot:{name:'PII Must Not Leak',phone:'+962799999999'}});
  await Booking.create({...bookingBase,seats:1,adults:1,idempotencyKey:'ops-unchecked',customerSnapshot:{name:'Other PII',phone:'+962788888888'}});
  await Booking.create({customerId:customer._id,providerId:providerSuspended._id,tripId:suspendedTrip._id,departureId:depSuspended._id,seats:2,adults:2,status:'confirmed',holdExpiresAt:new Date(Date.now()+3600000),idempotencyKey:'ops-suspended-confirmed',customerSnapshot:{name:'Suspended PII',phone:'+962777777777'}});

  const tokenFor=user=>jwt.sign({sub:String(user._id)},process.env.JWT_SECRET,{expiresIn:'1h'});
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=`http://127.0.0.1:${port}`;
  const authHeaders={authorization:`Bearer ${tokenFor(admin)}`};
  const operationsUrl=`${base}/api/admin/operations`;

  const unauthenticated=await fetch(operationsUrl);
  assert.equal(unauthenticated.status,401);

  const customerDenied=await fetch(operationsUrl,{headers:{authorization:`Bearer ${tokenFor(customer)}`}});
  assert.equal(customerDenied.status,403);

  const providerDenied=await fetch(operationsUrl,{headers:{authorization:`Bearer ${tokenFor(provider)}`}});
  assert.equal(providerDenied.status,403);

  const response=await fetch(operationsUrl,{headers:authHeaders});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.healthy,false);
  assert.equal(body.alerts.paymentNeedsReview,1);
  assert.equal(body.alerts.notificationFailures24h,1);
  assert.equal(body.alerts.openSupport,1);
  assert.equal(body.queues.paymentNeedsReview.length,1);
  assert.equal(body.queues.paymentNeedsReview[0].status,'needs_review');
  assert.equal(body.queues.notificationFailures.length,1);
  assert.ok(body.queues.notificationFailures[0].error.length<=240);
  assert.equal(body.queues.openSupport.length,1);
  assert.equal(body.queues.openSupport[0].subject,'Need help');
  assert.equal(body.queues.openSupport[0].status,'open');
  assert.equal(body.queues.openSupport[0].customerId.name,'Customer Secret Name');
  assert.equal(body.queues.openSupport[0].message,undefined);
  assert.equal(body.queues.openSupport[0].customerId.email,undefined);

  const serialized=JSON.stringify(body);
  assert.doesNotMatch(serialized,new RegExp(rawSecret));
  assert.doesNotMatch(serialized,/checkout-secret-must-not-leak/);
  assert.doesNotMatch(serialized,new RegExp(notificationRecipient.replace('.','\\.')));
  assert.doesNotMatch(serialized,new RegExp(notificationExternalId));
  assert.doesNotMatch(serialized,new RegExp(supportMessage));

  const departuresUrl=`${operationsUrl}/departures`;
  assert.equal((await fetch(`${departuresUrl}?date=${today}`)).status,401);
  assert.equal((await fetch(`${departuresUrl}?date=${today}`,{headers:{authorization:`Bearer ${tokenFor(customer)}`}})).status,403);
  assert.equal((await fetch(`${departuresUrl}?date=${today}`,{headers:{authorization:`Bearer ${tokenFor(provider)}`}})).status,403);

  const allResponse=await fetch(`${departuresUrl}?date=${today}`,{headers:authHeaders});
  assert.equal(allResponse.status,200);
  const all=await allResponse.json();
  assert.equal(all.date,today);
  assert.equal(all.timezone,'Asia/Amman');
  assert.equal(all.items.length,6);
  assert.deepEqual(all.items.map(item=>item.providerName),['Alpha Marine','Bravo Boats','Alpha Marine','Alpha Marine','Suspended Sea','Bravo Boats']);
  assert.deepEqual(all.items.map(item=>new Date(item.startsAt).getTime()),[depA,depB,depPlatformPaused,depProviderPaused,depSuspended,depCancelled].map(item=>new Date(item.startsAt).getTime()));

  const aRow=all.items.find(item=>item.departureId===String(depA._id));
  assert.equal(aRow.capacity,10);
  assert.equal(aRow.reservedSeats,5);
  assert.equal(aRow.availableSeats,5);
  assert.equal(aRow.confirmedBookings,2);
  assert.equal(aRow.confirmedSeats,3);
  assert.equal(aRow.checkedInBookings,1);
  assert.equal(aRow.checkedInSeats,2);
  assert.equal(aRow.vesselName,'Alpha One');

  const platformRow=all.items.find(item=>item.departureId===String(depPlatformPaused._id));
  assert.equal(platformRow.platformStatus,'paused');
  assert.equal(platformRow.salesOpen,false);
  assert.equal(platformRow.salesReason,'platform_paused');

  const providerPausedRow=all.items.find(item=>item.departureId===String(depProviderPaused._id));
  assert.equal(providerPausedRow.tripProviderActive,false);
  assert.equal(providerPausedRow.salesOpen,false);
  assert.equal(providerPausedRow.salesReason,'provider_paused');

  const suspendedRow=all.items.find(item=>item.departureId===String(depSuspended._id));
  assert.equal(suspendedRow.providerStatus,'suspended');
  assert.equal(suspendedRow.confirmedSeats,2);
  assert.equal(suspendedRow.salesOpen,false);
  assert.equal(suspendedRow.salesReason,'provider_blocked');

  const cancelledRow=all.items.find(item=>item.departureId===String(depCancelled._id));
  assert.equal(cancelledRow.status,'cancelled');
  assert.equal(cancelledRow.salesOpen,false);
  assert.equal(cancelledRow.salesReason,'departure_cancelled');

  const providerFiltered=await (await fetch(`${departuresUrl}?date=${today}&providerId=${providerA._id}`,{headers:authHeaders})).json();
  assert.equal(providerFiltered.items.length,3);
  assert.ok(providerFiltered.items.every(item=>item.providerId===String(providerA._id)));

  const statusFiltered=await (await fetch(`${departuresUrl}?date=${today}&status=cancelled`,{headers:authHeaders})).json();
  assert.equal(statusFiltered.items.length,1);
  assert.equal(statusFiltered.items[0].departureId,String(depCancelled._id));

  const closedFiltered=await (await fetch(`${departuresUrl}?date=${today}&sales=closed`,{headers:authHeaders})).json();
  assert.ok(closedFiltered.items.some(item=>item.departureId===String(depPlatformPaused._id)));
  assert.ok(closedFiltered.items.some(item=>item.departureId===String(depSuspended._id)));

  const tomorrowResponse=await (await fetch(`${departuresUrl}?date=${tomorrow}`,{headers:authHeaders})).json();
  assert.equal(tomorrowResponse.items.length,1);
  assert.equal(tomorrowResponse.items[0].tripId,String(tripA._id));

  const emptyResponse=await (await fetch(`${departuresUrl}?date=${emptyDay}`,{headers:authHeaders})).json();
  assert.deepEqual(emptyResponse.items,[]);

  const safe=JSON.stringify(all);
  assert.doesNotMatch(safe,/Customer Secret Name/);
  assert.doesNotMatch(safe,/customer-secret@example\.test/);
  assert.doesNotMatch(safe,/PII Must Not Leak|Other PII|Suspended PII/);
  assert.doesNotMatch(safe,/\+962799999999|\+962788888888|\+962777777777/);
  assert.doesNotMatch(safe,/ticket|token|checkoutUrl|rawLastEvent|pricing/i);
});
