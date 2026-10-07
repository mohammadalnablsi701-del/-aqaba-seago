import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import ProviderMember from '../src/models/ProviderMember.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Booking from '../src/models/Booking.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test('provider role permissions are enforced at HTTP boundaries',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  const oldCommission=process.env.DEFAULT_COMMISSION_PERCENTAGE;
  process.env.JWT_SECRET='provider-role-test-secret-at-least-32-characters';
  process.env.DEFAULT_COMMISSION_PERCENTAGE='10';

  await mongoose.connect(uri,{dbName:'seago_provider_roles_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldCommission===undefined)delete process.env.DEFAULT_COMMISSION_PERCENTAGE;else process.env.DEFAULT_COMMISSION_PERCENTAGE=oldCommission;
  });

  await Promise.all([User,Provider,ProviderMember,Trip,Departure,Booking].map(m=>m.init()));

  const owner=await User.create({name:'Owner',phone:'+962790001001',role:'provider'});
  const manager=await User.create({name:'Manager',phone:'+962790001002',role:'provider'});
  const staff=await User.create({name:'Staff',phone:'+962790001003',role:'provider'});
  const checkin=await User.create({name:'Check In',phone:'+962790001004',role:'provider'});
  const customer=await User.create({name:'Customer',phone:'+962790001005',role:'customer'});

  const provider=await Provider.create({ownerUserId:owner._id,businessName:'Role Test Provider',status:'approved'});
  await ProviderMember.create([
    {providerId:provider._id,userId:manager._id,role:'manager',createdBy:owner._id},
    {providerId:provider._id,userId:staff._id,role:'staff',createdBy:owner._id},
    {providerId:provider._id,userId:checkin._id,role:'checkin',createdBy:owner._id}
  ]);

  const trip=await Trip.create({
    providerId:provider._id,titleAr:'رحلة صلاحيات',titleEn:'Role test trip',category:'yacht',durationMinutes:60,active:true,
    pricing:{currency:'JOD',pricePerPerson:20,adultPrice:20,childPrice:10,commissionType:'percentage',commissionValue:10}
  });
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+2*86400000),capacity:20,reservedSeats:1,status:'scheduled'});
  const booking=await Booking.create({
    customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,
    seats:1,adults:1,children:0,mealPlan:'without_buffet',status:'confirmed',
    holdExpiresAt:new Date(Date.now()+300000),pricing:{currency:'JOD',grossAmount:20,commissionAmount:2,providerNetAmount:18},
    idempotencyKey:crypto.randomUUID()
  });

  const tokens=Object.fromEntries([owner,manager,staff,checkin].map(u=>[
    String(u._id),jwt.sign({sub:String(u._id)},process.env.JWT_SECRET,{expiresIn:'1h'})
  ]));
  const token=u=>tokens[String(u._id)];

  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=`http://127.0.0.1:${port}`;

  async function request(path,{user,method='GET',body}={}){
    return fetch(base+path,{
      method,
      headers:{authorization:`Bearer ${token(user)}`,...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined
    });
  }

  await t.test('only owner can manage provider team',async()=>{
    const ownerRes=await request('/api/providers/me/team',{user:owner});
    assert.equal(ownerRes.status,200);
    const ownerBody=await ownerRes.json();
    assert.equal(ownerBody.members.length,3);

    for(const user of [manager,staff,checkin]){
      const r=await request('/api/providers/me/team',{user});
      assert.equal(r.status,403);
    }
  });

  await t.test('manager can manage trips, staff and check-in cannot',async()=>{
    const payload={
      titleAr:'رحلة مدير',titleEn:'Manager trip',category:'group_boat',durationMinutes:90,
      pricing:{adultPrice:25,childPrice:15,buffetEnabled:false}
    };
    const managerRes=await request('/api/trips',{user:manager,method:'POST',body:payload});
    assert.equal(managerRes.status,201);

    for(const user of [staff,checkin]){
      const r=await request('/api/trips',{user,method:'POST',body:{...payload,titleEn:`Denied ${user.name}`}});
      assert.equal(r.status,403);
    }
  });

  await t.test('staff can manage departures but check-in role cannot',async()=>{
    const staffRes=await request('/api/departures',{user:staff,method:'POST',body:{
      tripId:trip._id,startsAt:new Date(Date.now()+3*86400000).toISOString(),capacity:12
    }});
    assert.equal(staffRes.status,201);

    const denied=await request('/api/departures',{user:checkin,method:'POST',body:{
      tripId:trip._id,startsAt:new Date(Date.now()+4*86400000).toISOString(),capacity:12
    }});
    assert.equal(denied.status,403);
  });

  await t.test('manager can view finance, staff and check-in cannot',async()=>{
    const managerRes=await request('/api/providers/me/stats',{user:manager});
    assert.equal(managerRes.status,200);
    const finance=await managerRes.json();
    assert.equal(finance.gross,20);
    assert.equal(finance.commission,2);
    assert.equal(finance.providerNet,18);

    for(const user of [staff,checkin]){
      const r=await request('/api/providers/me/stats',{user});
      assert.equal(r.status,403);
    }
  });

  await t.test('booking list redacts finance from staff/check-in but not manager',async()=>{
    const managerRes=await request('/api/providers/me/bookings',{user:manager});
    assert.equal(managerRes.status,200);
    const managerRows=await managerRes.json();
    assert.equal(managerRows.length,1);
    assert.equal(managerRows[0].pricing.providerNetAmount,18);

    for(const user of [staff,checkin]){
      const r=await request('/api/providers/me/bookings',{user});
      assert.equal(r.status,200);
      const rows=await r.json();
      assert.equal(rows.length,1);
      assert.equal(Object.prototype.hasOwnProperty.call(rows[0],'pricing'),false);
      assert.equal(Object.prototype.hasOwnProperty.call(rows[0],'cancellation'),false);
    }
  });

  await t.test('check-in-only member can check in but cannot gain management capability',async()=>{
    const checkRes=await request(`/api/providers/me/bookings/${booking._id}/check-in`,{user:checkin,method:'POST'});
    assert.equal(checkRes.status,200);
    const fresh=await Booking.findById(booking._id);
    assert.ok(fresh.checkedInAt);
    assert.equal(fresh.checkInCount,1);
    assert.equal(String(fresh.checkedInBy),String(checkin._id));

    const tripDenied=await request(`/api/trips/${trip._id}`,{user:checkin,method:'PATCH',body:{titleEn:'Unauthorized edit'}});
    assert.equal(tripDenied.status,403);
  });
});
