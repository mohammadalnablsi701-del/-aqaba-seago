import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import {signTicketToken} from '../src/services/tickets.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Booking from '../src/models/Booking.js';
import ProviderMember from '../src/models/ProviderMember.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test('ticket provider isolation and exactly-once check-in',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='ticket-checkin-test-secret-at-least-32-characters';
  await mongoose.connect(uri,{dbName:'seago_ticket_test_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });
  await Promise.all([User,Provider,Trip,Departure,Booking,ProviderMember].map(m=>m.init()));

  const owner1=await User.create({name:'Provider One',phone:'+962790000011',role:'provider'});
  const owner2=await User.create({name:'Provider Two',phone:'+962790000012',role:'provider'});
  const customer=await User.create({name:'Customer',phone:'+962790000013',role:'customer'});
  const provider1=await Provider.create({ownerUserId:owner1._id,businessName:'Provider One',status:'approved'});
  await Provider.create({ownerUserId:owner2._id,businessName:'Provider Two',status:'approved'});
  const trip=await Trip.create({
    providerId:provider1._id,titleAr:'رحلة اختبار',titleEn:'Ticket test',category:'yacht',durationMinutes:60,active:true,
    pricing:{currency:'JOD',pricePerPerson:20,adultPrice:20,commissionType:'fixed_per_person',commissionValue:4}
  });
  const dep=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:10,reservedSeats:2,status:'scheduled'});
  const booking=await Booking.create({
    customerId:customer._id,providerId:provider1._id,tripId:trip._id,departureId:dep._id,
    seats:2,adults:2,children:0,mealPlan:'without_buffet',status:'confirmed',
    holdExpiresAt:new Date(Date.now()+300000),pricing:{currency:'JOD',grossAmount:40,commissionAmount:8,providerNetAmount:32},
    idempotencyKey:crypto.randomUUID()
  });
  const ticket=signTicketToken(booking);
  const token1=jwt.sign({sub:String(owner1._id)},process.env.JWT_SECRET,{expiresIn:'1h'});
  const token2=jwt.sign({sub:String(owner2._id)},process.env.JWT_SECRET,{expiresIn:'1h'});

  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const url=`http://127.0.0.1:${port}/api/tickets/check-in`;
  const call=auth=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify({token:ticket})});

  await t.test('wrong provider is rejected and cannot mutate the ticket',async()=>{
    const r=await call(token2);
    assert.equal(r.status,403);
    const fresh=await Booking.findById(booking._id);
    assert.equal(fresh.checkedInAt??null,null);
    assert.equal(fresh.checkInCount,0);
  });

  await t.test('two simultaneous scans allow exactly one successful check-in',async()=>{
    const [a,b]=await Promise.all([call(token1),call(token1)]);
    const statuses=[a.status,b.status].sort((x,y)=>x-y);
    assert.deepEqual(statuses,[200,409]);
    const fresh=await Booking.findById(booking._id);
    assert.ok(fresh.checkedInAt);
    assert.equal(fresh.checkInCount,1);
    assert.equal(String(fresh.checkedInBy),String(owner1._id));
  });

  await t.test('a later second scan remains rejected without financial or counter mutation',async()=>{
    const before=await Booking.findById(booking._id);
    const r=await call(token1);
    assert.equal(r.status,409);
    const after=await Booking.findById(booking._id);
    assert.equal(after.checkInCount,1);
    assert.equal(after.checkedInAt.getTime(),before.checkedInAt.getTime());
  });
});
