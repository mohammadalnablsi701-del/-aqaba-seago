import { cleanupFixtures, requireFixture, connectFixture } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import {createApp} from "../src/app.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import Booking from "../src/models/Booking.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Payment from "../src/models/Payment.js";
import ProviderSettlement from "../src/models/ProviderSettlement.js";
import SettlementCorrection from "../src/models/SettlementCorrection.js";
import AdminAuditLog from "../src/models/AdminAuditLog.js";
import {settlementLedger} from "../src/services/settlements.js";

requireFixture();
test.after(cleanupFixtures);
const SECRET="settlement-payment-safety-test-secret-at-least-32-chars";
const money=n=>Number(Number(n||0).toFixed(2));

async function requestJson(base,path,{token,method="GET",body}={}){
  const response=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(body!==undefined?{"content-type":"application/json"}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json().catch(()=>({}));
  return{response,json};
}

test("Settlement Payment Safety hardening",{},async t=>{

  const oldSecret=process.env.JWT_SECRET,oldLimit=process.env.API_RATE_LIMIT;
  process.env.JWT_SECRET=SECRET;process.env.API_RATE_LIMIT="5000";
  await connectFixture();
  t.after(async()=>{
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldLimit===undefined)delete process.env.API_RATE_LIMIT;else process.env.API_RATE_LIMIT=oldLimit;
  });
  await Promise.all([User,Provider,Trip,Departure,Booking,CheckoutHold,Payment,ProviderSettlement,SettlementCorrection,AdminAuditLog].map(m=>m.init()));

  const admin=await User.create({name:"Settlement Admin",email:"settlement-admin@example.test",role:"admin"});
  const adminNoEmail=await User.create({name:"Audit Failure Admin",phone:"+962790009991",role:"admin"});
  const providerUser=await User.create({name:"Provider User",email:"settlement-provider@example.test",role:"provider",isActive:true});
  const customer=await User.create({name:"Customer",email:"settlement-customer@example.test",role:"customer"});
  const tokenFor=user=>jwt.sign({sub:String(user._id),ver:Number(user.authVersion||0)},SECRET,{expiresIn:"1h"});
  const adminToken=tokenFor(admin),noEmailAdminToken=tokenFor(adminNoEmail),providerToken=tokenFor(providerUser),customerToken=tokenFor(customer);

  const app=createApp();const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const from="2026-10-01",to="2026-10-31";
  let seq=0;

  async function fixture({gross=100,commission=20,refund=0,label="case"}={}){
    seq+=1;const suffix=`${label}-${seq}`;
    const owner=await User.create({name:`Owner ${suffix}`,email:`owner-${suffix}@example.test`,role:"provider",isActive:true});
    const provider=await Provider.create({ownerUserId:owner._id,businessName:`Provider ${suffix}`,status:"approved",approvedAt:new Date(),approvedBy:admin._id});
    const trip=await Trip.create({providerId:provider._id,titleAr:`رحلة ${suffix}`,titleEn:`Trip ${suffix}`,category:"yacht",durationMinutes:60,active:true,platformStatus:"allowed",pricing:{currency:"JOD",pricePerPerson:gross,commissionType:"percentage",commissionValue:gross?commission/gross*100:0}});
    const departure=await Departure.create({tripId:trip._id,startsAt:new Date("2026-10-20T09:00:00Z"),capacity:20,reservedSeats:1,status:"scheduled"});
    const providerNet=money(gross-commission);
    const booking=await Booking.create({customerId:customer._id,customerSnapshot:{name:"Customer",phone:"+962790001234"},providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,status:refund>=gross?"refunded":"confirmed",holdExpiresAt:new Date("2026-10-20T08:00:00Z"),pricing:{currency:"JOD",grossAmount:gross,commissionAmount:commission,providerNetAmount:providerNet},idempotencyKey:`booking-${suffix}`});
    const hold=await CheckoutHold.create({customerId:customer._id,providerId:provider._id,tripId:trip._id,departureId:departure._id,seats:1,adults:1,children:0,pricing:{currency:"JOD",grossAmount:gross,commissionAmount:commission,providerNetAmount:providerNet},idempotencyKey:`hold-${suffix}`,expiresAt:new Date("2026-10-20T08:00:00Z"),status:"paid"});
    const payment=await Payment.create({bookingId:booking._id,holdId:hold._id,customerId:customer._id,provider:"mock",externalPaymentId:`payment-${suffix}`,status:refund===0?"paid":refund>=gross?"refunded":"partially_refunded",amount:gross,currency:"JOD",paidAt:new Date("2026-10-10T10:00:00Z"),refundedAmount:refund,refundedAt:refund?new Date("2026-10-11T10:00:00Z"):undefined});
    return{owner,provider,trip,departure,booking,hold,payment,providerNet};
  }
  const payBody=(f,reason="Bank transfer completed")=>({providerId:String(f.provider._id),from,to,reason});

  await t.test("A/B/W/X: settlement mutations require admin authentication and role",async()=>{
    const f=await fixture({label:"auth"});
    const unauth=await requestJson(base,"/api/admin/settlements/pay",{method:"POST",body:payBody(f)});assert.equal(unauth.response.status,401);
    for(const token of [providerToken,customerToken]){
      const denied=await requestJson(base,"/api/admin/settlements/pay",{token,method:"POST",body:payBody(f)});assert.equal(denied.response.status,403);
    }
    assert.equal(await ProviderSettlement.countDocuments({providerId:f.provider._id}),0);
  });

  await t.test("C/D/E/I: reason is required, whitespace rejected, payload is exact, actor cannot be spoofed",async()=>{
    const f=await fixture({label:"validation"});
    for(const body of [
      {providerId:String(f.provider._id),from,to},
      {providerId:String(f.provider._id),from,to,reason:"   "},
      {...payBody(f),amount:1},
      {...payBody(f),currency:"USD"},
      {...payBody(f),paidBy:String(providerUser._id)}
    ]){
      const r=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body});assert.equal(r.response.status,400);
    }
    assert.equal(await ProviderSettlement.countDocuments({providerId:f.provider._id}),0);
  });

  let primary,primarySettlement,primaryPaidAt;
  await t.test("F/G/H/L/M/Y: Mark Paid writes server truth exactly once with audited historical snapshots",async()=>{
    primary=await fixture({label:"primary"});
    const bookingBefore=(await Booking.findById(primary.booking._id).lean()).pricing;
    const before=Date.now();
    const r=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(primary,"Bank transfer completed REF-1001")});
    assert.equal(r.response.status,201);assert.equal(r.json.status,"paid");
    primarySettlement=await ProviderSettlement.findOne({providerId:primary.provider._id}).lean();
    assert.ok(primarySettlement);primaryPaidAt=primarySettlement.paidAt;
    assert.ok(primaryPaidAt.getTime()>=before&&primaryPaidAt.getTime()<=Date.now()+1000);
    assert.equal(String(primarySettlement.paidBy),String(admin._id));assert.equal(primarySettlement.reason,"Bank transfer completed REF-1001");
    assert.equal(primarySettlement.amountPaid,80);assert.equal(primarySettlement.currency,"JOD");
    assert.deepEqual((await Booking.findById(primary.booking._id).lean()).pricing,bookingBefore);
    const audit=await AdminAuditLog.findOne({action:"settlement_marked_paid",entityId:primarySettlement._id}).lean();
    assert.ok(audit);assert.equal(String(audit.actorUserId),String(admin._id));assert.equal(audit.reason,"Bank transfer completed REF-1001");
    assert.equal(audit.before.status,"outstanding");assert.equal(audit.before.payableNow,80);assert.equal(audit.after.status,"paid");assert.equal(audit.after.amountPaid,80);assert.equal(audit.after.currency,"JOD");
  });

  await t.test("J/AB: duplicate Mark Paid is a safe conflict with no duplicate financial or audit event",async()=>{
    const duplicate=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(primary,"Duplicate submit")});
    assert.equal(duplicate.response.status,409);
    assert.equal(await ProviderSettlement.countDocuments({providerId:primary.provider._id}),1);
    assert.equal(await AdminAuditLog.countDocuments({action:"settlement_marked_paid",entityId:primarySettlement._id}),1);
    const unchanged=await ProviderSettlement.findById(primarySettlement._id).lean();assert.equal(unchanged.paidAt.getTime(),primaryPaidAt.getTime());assert.equal(String(unchanged.paidBy),String(admin._id));
  });

  await t.test("K: concurrent Mark Paid yields one effective transition",async()=>{
    const f=await fixture({label:"concurrent-pay"});
    const [a,b]=await Promise.all([
      requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(f,"Concurrent transfer A")}),
      requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(f,"Concurrent transfer B")})
    ]);
    assert.deepEqual([a.response.status,b.response.status].sort(),[201,409]);
    const rows=await ProviderSettlement.find({providerId:f.provider._id}).lean();assert.equal(rows.length,1);
    assert.equal(await AdminAuditLog.countDocuments({action:"settlement_marked_paid",entityId:rows[0]._id}),1);
  });

  await t.test("N: forced audit validation failure rolls back settlement and settlementRevision",async()=>{
    const f=await fixture({label:"audit-rollback"});
    const beforeRevision=(await Payment.findById(f.payment._id)).settlementRevision;
    const r=await requestJson(base,"/api/admin/settlements/pay",{token:noEmailAdminToken,method:"POST",body:payBody(f,"Transfer with failing audit actor")});
    assert.equal(r.response.status,500);
    assert.equal(await ProviderSettlement.countDocuments({providerId:f.provider._id}),0);
    assert.equal((await Payment.findById(f.payment._id)).settlementRevision,beforeRevision);
  });

  await t.test("O/P/W/X: reversal requires admin and a bounded non-whitespace reason",async()=>{
    for(const token of [providerToken,customerToken]){
      const denied=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token,method:"POST",body:{reason:"Unauthorized reversal"}});assert.equal(denied.response.status,403);
    }
    const missing=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"POST",body:{}});assert.equal(missing.response.status,400);
    const whitespace=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"POST",body:{reason:"   "}});assert.equal(whitespace.response.status,400);
    const spoof=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"POST",body:{reason:"Correction",actorUserId:String(providerUser._id)}});assert.equal(spoof.response.status,400);
  });

  await t.test("Q/R/S/V: correction is append-only, original Paid history remains, effective payout becomes zero, no edit/delete API",async()=>{
    const original=await ProviderSettlement.findById(primarySettlement._id).lean();
    const r=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"POST",body:{reason:"Settlement was marked paid before bank transfer completed"}});
    assert.equal(r.response.status,201);assert.equal(r.json.paymentTruth,"reversed");assert.equal(r.json.effectiveAmountPaid,0);assert.equal(r.json.amountDelta,-80);
    const correction=await SettlementCorrection.findOne({settlementId:primarySettlement._id});assert.ok(correction);assert.equal(String(correction.actorUserId),String(admin._id));
    const after=await ProviderSettlement.findById(primarySettlement._id).lean();assert.equal(after.status,"paid");assert.equal(after.amountPaid,original.amountPaid);assert.equal(after.paidAt.getTime(),original.paidAt.getTime());assert.equal(String(after.paidBy),String(original.paidBy));
    correction.reason="Attempted edit";await assert.rejects(correction.save(),/append-only/i);
    await assert.rejects(SettlementCorrection.updateOne({_id:correction._id},{$set:{reason:"Attempted query edit"}}),/append-only/i);
    await assert.rejects(SettlementCorrection.deleteOne({_id:correction._id}),/append-only/i);
    const patch=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"PATCH",body:{reason:"Edit"}});assert.equal(patch.response.status,404);
    const del=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"DELETE"});assert.equal(del.response.status,404);
    const ledger=await settlementLedger({providerId:String(primary.provider._id)});const row=ledger.breakdown.find(x=>String(x.providerId)===String(primary.provider._id));
    assert.equal(row.paid,0);assert.equal(row.outstanding,80);assert.equal(row.payableNow,0);assert.equal(row.reversedOutstanding,80);
    const history=await requestJson(base,`/api/admin/settlements?providerId=${primary.provider._id}`,{token:adminToken});assert.equal(history.response.status,200);const item=history.json.history.find(x=>String(x.id)===String(primarySettlement._id));assert.equal(item.status,"paid");assert.equal(item.paymentTruth,"reversed");assert.equal(item.effectiveAmountPaid,0);assert.equal(item.corrections.length,1);
    const audit=await AdminAuditLog.findOne({action:"settlement_payment_reversed",entityId:primarySettlement._id}).lean();assert.equal(audit.before.paymentTruth,"paid");assert.equal(audit.before.effectiveAmountPaid,80);assert.equal(audit.after.paymentTruth,"reversed");assert.equal(audit.after.effectiveAmountPaid,0);assert.match(audit.reason,/bank transfer/i);
    const repay=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(primary,"Later real payment attempt")});assert.equal(repay.response.status,409);
  });

  await t.test("T: duplicate reversal is blocked with no duplicate correction or audit",async()=>{
    const r=await requestJson(base,`/api/admin/settlements/${primarySettlement._id}/reverse`,{token:adminToken,method:"POST",body:{reason:"Duplicate reversal"}});assert.equal(r.response.status,409);
    assert.equal(await SettlementCorrection.countDocuments({settlementId:primarySettlement._id}),1);
    assert.equal(await AdminAuditLog.countDocuments({action:"settlement_payment_reversed",entityId:primarySettlement._id}),1);
  });

  await t.test("U: concurrent reversal yields one append-only correction",async()=>{
    const f=await fixture({label:"concurrent-reversal"});
    const paid=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(f,"Transfer completed")});assert.equal(paid.response.status,201);
    const [a,b]=await Promise.all([
      requestJson(base,`/api/admin/settlements/${paid.json.id}/reverse`,{token:adminToken,method:"POST",body:{reason:"Concurrent reversal A"}}),
      requestJson(base,`/api/admin/settlements/${paid.json.id}/reverse`,{token:adminToken,method:"POST",body:{reason:"Concurrent reversal B"}})
    ]);
    assert.deepEqual([a.response.status,b.response.status].sort(),[201,409]);
    assert.equal(await SettlementCorrection.countDocuments({settlementId:paid.json.id}),1);
    assert.equal(await AdminAuditLog.countDocuments({action:"settlement_payment_reversed",entityId:paid.json.id}),1);
  });

  await t.test("Z: refund before settlement uses Payment refund truth without mutating Booking pricing snapshot",async()=>{
    const f=await fixture({label:"refund-before",gross:100,commission:20,refund:25});
    const bookingBefore=(await Booking.findById(f.booking._id).lean()).pricing;
    const ledger=await settlementLedger({providerId:String(f.provider._id)});const row=ledger.breakdown.find(x=>String(x.providerId)===String(f.provider._id));
    assert.equal(row.providerNet,60);assert.equal(row.seaGoCommission,15);assert.equal(row.refunds,25);assert.equal(row.payableNow,60);
    const paid=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(f,"Net payout after customer refund")});assert.equal(paid.response.status,201);assert.equal(paid.json.amountPaid,60);
    assert.deepEqual((await Booking.findById(f.booking._id).lean()).pricing,bookingBefore);
  });

  await t.test("AA: refund after paid settlement remains visible as recovery liability and never rewrites original settlement",async()=>{
    const f=await fixture({label:"refund-after"});
    const paid=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(f,"Initial provider payout")});assert.equal(paid.response.status,201);assert.equal(paid.json.amountPaid,80);
    const original=await ProviderSettlement.findById(paid.json.id).lean();
    await Payment.updateOne({_id:f.payment._id},{$set:{status:"partially_refunded",refundedAmount:25,refundedAt:new Date("2026-10-12T12:00:00Z")}});
    const ledger=await settlementLedger({providerId:String(f.provider._id)});const row=ledger.breakdown.find(x=>String(x.providerId)===String(f.provider._id));
    assert.equal(row.providerNet,60);assert.equal(row.paid,80);assert.equal(row.recoveryDue,20);assert.equal(row.outstanding,-20);
    const stillOriginal=await ProviderSettlement.findById(paid.json.id).lean();assert.equal(stillOriginal.amountPaid,original.amountPaid);assert.equal(stillOriginal.paidAt.getTime(),original.paidAt.getTime());
    const blocked=await requestJson(base,"/api/admin/settlements/pay",{token:adminToken,method:"POST",body:payBody(f,"Should remain blocked")});assert.equal(blocked.response.status,409);
  });
});
