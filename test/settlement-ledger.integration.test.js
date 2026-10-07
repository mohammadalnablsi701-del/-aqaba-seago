import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {settlementLedger,recordSettlement} from '../src/services/settlements.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Booking from '../src/models/Booking.js';
import Payment from '../src/models/Payment.js';
import ProviderSettlement from '../src/models/ProviderSettlement.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import CheckoutHold from '../src/models/CheckoutHold.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const money=n=>Number(Number(n).toFixed(2));

test('provider/admin settlement ledger matches hand-calculated cash economics',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  await mongoose.connect(uri,{dbName:'seago_settlement_test_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
  await Promise.all([User,Provider,Booking,Payment,ProviderSettlement,Trip,Departure,CheckoutHold].map(m=>m.init()));

  const admin=await User.create({name:'Admin',phone:'+962790001001',role:'admin'});
  const owner=await User.create({name:'Owner',phone:'+962790001002',role:'provider'});
  const customer=await User.create({name:'Customer',phone:'+962790001003',role:'customer'});
  const provider=await Provider.create({ownerUserId:owner._id,businessName:'Ledger Provider',status:'approved'});
  const trip=await Trip.create({providerId:provider._id,titleAr:'رحلة مالية',titleEn:'Ledger Trip',category:'yacht',durationMinutes:60,active:true,pricing:{currency:'JOD',pricePerPerson:20,commissionType:'percentage',commissionValue:20}});
  const departure=await Departure.create({tripId:trip._id,startsAt:new Date(Date.now()+86400000),capacity:20,reservedSeats:3,status:'scheduled'});

  async function paidBooking({gross,commission,refund=0,suffix}){
    const providerNet=money(gross-commission);
    const booking=await Booking.create({customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,status:refund>=gross?'refunded':'confirmed',holdExpiresAt:new Date(Date.now()+300000),pricing:{currency:'JOD',grossAmount:gross,commissionAmount:commission,providerNetAmount:providerNet},idempotencyKey:'ledger-'+suffix});
    const hold=await CheckoutHold.create({customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,pricing:{currency:'JOD',grossAmount:gross,commissionAmount:commission,providerNetAmount:providerNet},idempotencyKey:'hold-'+suffix,expiresAt:new Date(Date.now()+300000),status:'paid'});
    return Payment.create({bookingId:booking._id,holdId:hold._id,customerId:customer._id,provider:'mock',externalPaymentId:'ledger-'+suffix,status:refund===0?'paid':refund>=gross?'refunded':'partially_refunded',amount:gross,currency:'JOD',paidAt:new Date(),refundedAmount:refund,refundedAt:refund?new Date():undefined});
  }

  // Booking A: 100 gross, 20 commission, 80 provider net.
  // Booking B: 50 gross, 10 commission, then 25 refund (50% retained),
  //            so effective commission=5 and provider net=20.
  const p1=await paidBooking({gross:100,commission:20,suffix:'a'});
  const p2=await paidBooking({gross:50,commission:10,refund:25,suffix:'b'});

  const before=await settlementLedger({providerId:String(provider._id)});
  const row=before.breakdown.find(x=>String(x.providerId)===String(provider._id));
  assert.ok(row);
  assert.equal(row.bookings,2);
  assert.equal(row.grossSales,150);
  assert.equal(row.refunds,25);
  assert.equal(row.seaGoCommission,25);
  assert.equal(row.providerNet,100);
  assert.equal(row.paid,0);
  assert.equal(row.outstanding,100);
  assert.equal(row.recoveryDue,0);
  assert.deepEqual(before.totals,{grossSales:150,refunds:25,seaGoCommission:25,providerNet:100,paid:0,outstanding:100,recoveryDue:0});

  const from=new Date(Date.now()-3600000),to=new Date(Date.now()+3600000);
  const settlement=await recordSettlement({from,to,providerId:String(provider._id),paidBy:admin._id,note:'hand-calculated verification'});
  assert.equal(settlement.amountPaid,100);
  assert.equal(settlement.providerNet,100);
  assert.equal(settlement.seaGoCommission,25);
  assert.equal(settlement.refunds,25);
  assert.deepEqual(new Set(settlement.paymentIds.map(String)),new Set([String(p1._id),String(p2._id)]));

  const after=await settlementLedger({providerId:String(provider._id)});
  const afterRow=after.breakdown.find(x=>String(x.providerId)===String(provider._id));
  assert.equal(afterRow.providerNet,100);
  assert.equal(afterRow.paid,100);
  assert.equal(afterRow.outstanding,0);
  assert.equal(afterRow.recoveryDue,0);

  await assert.rejects(recordSettlement({from,to,providerId:String(provider._id),paidBy:admin._id}),err=>err?.statusCode===409);
  assert.equal(await ProviderSettlement.countDocuments({providerId:provider._id}),1);
});
