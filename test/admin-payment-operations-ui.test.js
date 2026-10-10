import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLatestRequestManager} from '../admin-app/src/requestLifecycle.js';
import {buildQueuePreview,getAttentionCategories} from '../admin-app/src/operationsAttentionModel.js';

const component=fs.readFileSync(new URL('../admin-app/src/PaymentOperations.jsx',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../admin-app/src/paymentOperationsApi.js',import.meta.url),'utf8');
const attention=fs.readFileSync(new URL('../admin-app/src/OperationsAttention.jsx',import.meta.url),'utf8');
const bookingSupport=fs.readFileSync(new URL('../admin-app/src/BookingSupport.jsx',import.meta.url),'utf8');

function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return{promise,resolve,reject}}

test('payment operations UI is read-only, bounded, generic and secret-safe',()=>{
  assert.match(component,/Payment visibility/);
  assert.match(component,/No payments found\./);
  assert.match(component,/Payment is not linked to a booking\./);
  assert.match(component,/No payment events available\./);
  assert.match(component,/No force-paid, refund, retry, replay, or manual state controls\./);
  assert.match(component,/createdAt|updatedAt|externalPaymentId|refundedAmount/);
  assert.match(component,/status:"all"/);
  assert.match(component,/booking:"any"/);
  assert.match(component,/needsReview:"any"/);
  assert.match(component,/refund:"any"/);
  assert.match(component,/limit:25/);
  assert.match(component,/All gateways/);
  assert.match(component,/Payment ID · external ID · SG-/);
  assert.match(api,/\/api\/admin\/payments/);
  assert.doesNotMatch(api,/method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)/i);
  assert.doesNotMatch(component,/Force paid|Force failed|Retry payment|Retry webhook|Replay event|Partial refund|Cancel payment|Change external ID|Edit amount|Edit currency/i);
  assert.doesNotMatch(component,/dangerouslySetInnerHTML|innerHTML|checkoutUrl|rawLastEvent|Authorization header|webhook signatures|secret tokens/i);
});

test('Q rapid payment list changes are latest-request-wins and abort stale requests',async()=>{
  const manager=createLatestRequestManager();
  const oldRequest=manager.start();
  const old=deferred();
  const newRequest=manager.start();
  const latest=deferred();
  assert.equal(oldRequest.signal.aborted,true);
  let visible=null;
  const apply=async(request,promise)=>{const value=await promise;if(manager.isCurrent(request.id))visible=value};
  const oldRun=apply(oldRequest,old.promise);
  const latestRun=apply(newRequest,latest.promise);
  latest.resolve({filter:'needs_review'});await latestRun;
  old.resolve({filter:'paid'});await oldRun;
  assert.deepEqual(visible,{filter:'needs_review'});
  assert.match(component,/listManager\.current\.isCurrent\(request\.id\)/);
});

test('R background list/detail failure preserves last-known-good data',()=>{
  assert.match(component,/Last known payment list remains visible\./);
  assert.match(component,/Last known detail remains visible\./);
  assert.match(component,/setListError\(error\.message\|\|"Could not load payments"\)/);
  assert.match(component,/setDetailError\(error\.message\|\|"Could not load payment detail"\)/);
  assert.match(component,/if\(!preserve\)setDetail\(null\)/);
  assert.match(component,/loadDetail\(selectedId,\{preserve:true\}\)/);
});

test('S Operations Attention payment items open the real payment visibility surface',()=>{
  const data={alerts:{paymentNeedsReview:1,notificationFailures24h:0,openSupport:0},queues:{paymentNeedsReview:[{_id:'66aa00000000000012345678',externalPaymentId:'pay-review',status:'needs_review'}],notificationFailures:[],openSupport:[]}};
  const category=getAttentionCategories(data)[0];
  const item=buildQueuePreview(data)[0];
  assert.equal(category.destination,'payments');
  assert.equal(item.destination,'payments');
  assert.equal(item.targetId,'66aa00000000000012345678');
  assert.match(attention,/openPayments/);
  assert.match(attention,/paymentId:item\.targetId/);
  assert.match(attention,/<PaymentOperations token=\{token\}/);
});

test('T Payment detail can open the existing related Booking Support detail',()=>{
  assert.match(component,/sessionStorage\.setItem\("seago_booking_support_target",String\(bookingId\)\)/);
  assert.match(component,/onNavigate\?\.\("booking-support"\)/);
  assert.match(component,/>Open Booking Support</);
  assert.match(bookingSupport,/sessionStorage\.getItem\("seago_booking_support_target"\)/);
  assert.match(bookingSupport,/sessionStorage\.removeItem\("seago_booking_support_target"\)/);
  assert.match(bookingSupport,/loadDetail\(target\)/);
});
