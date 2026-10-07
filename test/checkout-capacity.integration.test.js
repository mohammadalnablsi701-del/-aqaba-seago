import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {reserveCheckout} from '../src/services/checkout.js';
import {releaseExpiredCheckoutHolds} from '../src/services/payments.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Hold from '../src/models/CheckoutHold.js';
import Payment from '../src/models/Payment.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test('checkout capacity and idempotency on isolated MongoDB replica set',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  await mongoose.connect(uri,{dbName:'seago_checkout_test_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
  await Promise.all([User,Provider,Trip,Departure,Hold,Payment].map(m=>m.init()));

  async function fixture(capacity=1){
    const owner=await User.create({name:'Provider owner',phone:'+962790000001',role:'provider'});
    const provider=await Provider.create({ownerUserId:owner._id,businessName:'Capacity test provider',status:'approved'});
    const trip=await Trip.create({
      providerId:provider._id,titleAr:'اختبار السعة',titleEn:'Capacity test',category:'yacht',durationMinutes:60,active:true,
      pricing:{currency:'JOD',pricePerPerson:20,adultPrice:20,childPrice:10,commissionType:'fixed_per_person',commissionValue:4}
    });
    const dep=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity,reservedSeats:0,status:'scheduled'});
    return {provider,trip,dep};
  }

  const customer=async name=>User.create({name,phone:'+96279'+String(Math.floor(Math.random()*1e7)).padStart(7,'0')});
  const reserve=(customerId,departureId,key=crypto.randomUUID(),adults=1,children=0)=>reserveCheckout({
    customerId,key,departureId,adults,children,mealPlan:'without_buffet'
  });

  await t.test('two customers racing for the final seat produce exactly one hold and one reserved seat',async()=>{
    const {dep}=await fixture(1);
    const [a,b]=await Promise.all([customer('A'),customer('B')]);
    const results=await Promise.allSettled([reserve(a._id,dep._id),reserve(b._id,dep._id)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected'&&r.reason?.statusCode===409).length,1);
    assert.equal((await Departure.findById(dep._id)).reservedSeats,1);
    assert.equal(await Hold.countDocuments({departureId:dep._id,status:'active'}),1);
    assert.equal(await Payment.countDocuments({holdId:{$in:await Hold.find({departureId:dep._id}).distinct('_id')}}),1);
  });

  await t.test('concurrent duplicate submit with the same key returns one hold and reserves inventory once',async()=>{
    const {dep}=await fixture(2);
    const c=await customer('Duplicate');
    const key=crypto.randomUUID();
    const [r1,r2,r3]=await Promise.all([reserve(c._id,dep._id,key),reserve(c._id,dep._id,key),reserve(c._id,dep._id,key)]);
    assert.equal(String(r1._id),String(r2._id));
    assert.equal(String(r2._id),String(r3._id));
    assert.equal((await Departure.findById(dep._id)).reservedSeats,1);
    assert.equal(await Hold.countDocuments({customerId:c._id,idempotencyKey:key}),1);
    assert.equal(await Payment.countDocuments({holdId:r1._id}),1);
  });

  await t.test('reusing an idempotency key for different seat details is rejected without changing capacity',async()=>{
    const {dep}=await fixture(3);
    const c=await customer('Mismatch');
    const key=crypto.randomUUID();
    await reserve(c._id,dep._id,key,1,0);
    await assert.rejects(reserve(c._id,dep._id,key,2,0),err=>err?.statusCode===409);
    assert.equal((await Departure.findById(dep._id)).reservedSeats,1);
    assert.equal(await Hold.countDocuments({customerId:c._id,idempotencyKey:key}),1);
  });

  await t.test('expired hold releases the seat and expires the pending payment exactly once',async()=>{
    const {dep}=await fixture(1);
    const c=await customer('Expiry');
    const hold=await reserve(c._id,dep._id);
    await Hold.updateOne({_id:hold._id},{$set:{expiresAt:new Date(Date.now()-1000)}});
    const [first,second]=await Promise.all([releaseExpiredCheckoutHolds(),releaseExpiredCheckoutHolds()]);
    assert.equal(first+second,1);
    assert.equal((await Departure.findById(dep._id)).reservedSeats,0);
    assert.equal((await Hold.findById(hold._id)).status,'expired');
    assert.equal((await Payment.findOne({holdId:hold._id})).status,'expired');
  });
});
