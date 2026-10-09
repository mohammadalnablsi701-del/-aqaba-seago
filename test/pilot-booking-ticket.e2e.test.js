import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import {processPaymentWebhook} from '../src/services/payments.js';
import {signTicketToken} from '../src/services/tickets.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Hold from '../src/models/CheckoutHold.js';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';
import Booking from '../src/models/Booking.js';
import ProviderMember from '../src/models/ProviderMember.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test('pilot customer -> payment -> ticket -> provider scan E2E',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'E2E is restricted to a local disposable MongoDB replica set');
  const saved={jwt:process.env.JWT_SECRET,webhook:process.env.MOCK_PAYMENT_WEBHOOK_SECRET};
  process.env.JWT_SECRET=crypto.randomBytes(48).toString('base64url');
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET=crypto.randomBytes(48).toString('base64url');
  await mongoose.connect(uri,{dbName:'seago_pilot_e2e_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();if(saved.jwt===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=saved.jwt;if(saved.webhook===undefined)delete process.env.MOCK_PAYMENT_WEBHOOK_SECRET;else process.env.MOCK_PAYMENT_WEBHOOK_SECRET=saved.webhook;});
  await Promise.all([User,Provider,Trip,Departure,Hold,Payment,PaymentEvent,Booking,ProviderMember].map(m=>m.init()));

  const seaOwner=await User.create({name:'Sea Breeze E2E',phone:'+962790001001',role:'provider'});
  const otherOwner=await User.create({name:'Other Provider E2E',phone:'+962790001002',role:'provider'});
  const customer=await User.create({name:'Pilot Customer',phone:'+962790001003',role:'customer'});
  const sea=await Provider.create({ownerUserId:seaOwner._id,businessName:'Sea Breeze / Aquamarina E2E',status:'approved'});
  await Provider.create({ownerUserId:otherOwner._id,businessName:'Other Provider E2E',status:'approved'});
  const trip=await Trip.create({providerId:sea._id,titleAr:'رحلة غروب اختبار',titleEn:'Sunset Cruise E2E',vesselName:'Breeze Wooden Boat',category:'sunset',durationMinutes:120,active:true,departureLocation:{name:'Ayla Marina, Aqaba, Jordan'},pricing:{currency:'JOD',pricePerPerson:15,adultPrice:15,childPrice:10,buffetEnabled:true,buffetAdultPrice:17,buffetChildPrice:12,commissionType:'fixed_per_person',commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:3,buffetChildCommission:2}});
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:10,reservedSeats:2,status:'scheduled'});
  const pricing={currency:'JOD',grossAmount:27,commissionAmount:5,providerNetAmount:22};
  const hold=await Hold.create({customerId:customer._id,providerId:sea._id,tripId:trip._id,departureId:departure._id,seats:2,adults:1,children:1,mealPlan:'with_buffet',pricing,idempotencyKey:crypto.randomUUID(),expiresAt:new Date(Date.now()+300000)});
  const payment=await Payment.create({holdId:hold._id,customerId:customer._id,provider:'mock',externalPaymentId:crypto.randomUUID(),amount:27,currency:'JOD',status:'pending'});
  const eventId=crypto.randomUUID();
  const rawBody=Buffer.from(JSON.stringify({eventId,externalPaymentId:payment.externalPaymentId,status:'paid',amount:27,currency:'JOD'}));
  const signature=crypto.createHmac('sha256',process.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
  await processPaymentWebhook({providerName:'mock',rawBody,signature});
  const booking=await Booking.findOne({departureId:departure._id});
  assert.ok(booking,'paid checkout must create a booking');
  assert.equal(booking.status,'confirmed');
  assert.equal(booking.pricing.grossAmount,27);
  assert.equal(booking.pricing.commissionAmount,5);
  assert.equal(booking.pricing.providerNetAmount,22);
  const ticket=signTicketToken(booking);
  const seaAuth=jwt.sign({sub:String(seaOwner._id)},process.env.JWT_SECRET,{expiresIn:'1h'});
  const otherAuth=jwt.sign({sub:String(otherOwner._id)},process.env.JWT_SECRET,{expiresIn:'1h'});

  const app=createApp();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const {port}=server.address();
  const call=(path,auth)=>fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify({token:ticket})});

  const inspect=await call('/api/tickets/inspect',seaAuth);assert.equal(inspect.status,200);const info=await inspect.json();assert.equal(info.valid,true);assert.equal(info.vesselName,'Breeze Wooden Boat');assert.equal(info.customer.name,'Pilot Customer');assert.equal(info.guests,2);
  const wrong=await call('/api/tickets/check-in',otherAuth);assert.equal(wrong.status,403);assert.equal((await Booking.findById(booking._id)).checkedInAt??null,null);
  const first=await call('/api/tickets/check-in',seaAuth);assert.equal(first.status,200);
  const used=await Booking.findById(booking._id);assert.ok(used.checkedInAt);assert.equal(used.checkInCount,1);
  const second=await call('/api/tickets/check-in',seaAuth);assert.equal(second.status,409);assert.equal((await Booking.findById(booking._id)).checkInCount,1);
});
