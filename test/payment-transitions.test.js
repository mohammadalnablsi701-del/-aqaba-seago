import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';
import CheckoutHold from '../src/models/CheckoutHold.js';
import {processPaymentWebhook} from '../src/services/payments.js';
const query=v=>({session(){return this},then(resolve,reject){return Promise.resolve(v).then(resolve,reject)}});
for(const state of ['paid','partially_refunded','refunded']){
 for(const incoming of ['paid','failed','pending']){
  test(`${incoming} event preserves ${state} without touching booking or inventory`,async t=>{
   const secret=process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
   process.env.MOCK_PAYMENT_WEBHOOK_SECRET='test-only-webhook-key';
   t.after(()=>{if(secret===undefined)delete process.env.MOCK_PAYMENT_WEBHOOK_SECRET;else process.env.MOCK_PAYMENT_WEBHOOK_SECRET=secret});
   const payment={_id:'p',status:state,amount:20,refundedAmount:state==='refunded'?20:0,save:()=>assert.fail('Terminal payment must not be saved')};
   t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
   t.mock.method(Payment,'findOne',()=>query(payment));
   t.mock.method(PaymentEvent,'exists',()=>query(false));
   let events=0;t.mock.method(PaymentEvent,'create',async()=>{events++});
   t.mock.method(CheckoutHold,'findById',()=>assert.fail('Terminal event must not touch inventory'));
   const rawBody=Buffer.from(JSON.stringify({eventId:'new-event',externalPaymentId:'x',status:incoming,amount:20,currency:'JOD'}));
   const signature=crypto.createHmac('sha256',process.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
   const result=await processPaymentWebhook({providerName:'mock',rawBody,signature});
   assert.equal(result.payment.status,state);assert.equal(events,1);
  });
 }
}
