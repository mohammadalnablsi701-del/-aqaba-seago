import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLatestRequestManager} from '../admin-app/src/requestLifecycle.js';

const component=fs.readFileSync(new URL('../admin-app/src/BookingSupport.jsx',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../admin-app/src/bookingSupportApi.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../admin-app/src/App.jsx',import.meta.url),'utf8');

function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done});
  return {promise,resolve};
}

test('booking support is read-only, submit-driven, scoped and secret-safe',()=>{
  assert.match(component,/onSubmit=\{runSearch\}/);
  assert.match(component,/Search by booking reference, email, or phone\./);
  assert.match(component,/No bookings found\./);
  assert.match(component,/Payment record not found\./);
  assert.match(component,/Ticket not available\./);
  assert.match(component,/Last known detail remains visible\./);
  assert.match(component,/const searchManager=useRef/);
  assert.match(component,/const detailManager=useRef/);
  assert.match(component,/searchManager\.current\.isCurrent/);
  assert.match(component,/detailManager\.current\.isCurrent/);
  assert.doesNotMatch(component,/dangerouslySetInnerHTML|innerHTML|rawLastEvent|checkoutUrl|ticketToken|ticketValidationUrl|HMAC/i);
  assert.doesNotMatch(api,/method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)/i);
  assert.match(api,/\/api\/admin\/bookings\/search/);
  assert.match(api,/\/api\/admin\/bookings\//);
  assert.match(app,/tab==="booking-support"/);
  assert.match(app,/>Booking Support</);
  assert.match(app,/<BookingSupport token=\{auth\.token\}\/>/);
  assert.doesNotMatch(app,/createPortal/);
});

test('rapid booking searches are latest-request-wins and abort stale work',async()=>{
  const manager=createLatestRequestManager();
  const first=manager.start();
  const old=deferred();
  const second=manager.start();
  const latest=deferred();
  assert.equal(first.signal.aborted,true);
  assert.equal(second.signal.aborted,false);

  let visible='';
  const apply=async(request,promise)=>{const value=await promise;if(manager.isCurrent(request.id))visible=value};
  const oldApply=apply(first,old.promise);
  const latestApply=apply(second,latest.promise);
  latest.resolve('new-search');
  await latestApply;
  old.resolve('old-search');
  await oldApply;
  assert.equal(visible,'new-search');
  manager.finish(second.id);
});

test('stale booking detail response cannot replace the newer selected booking',async()=>{
  const manager=createLatestRequestManager();
  const first=manager.start();
  const bookingA=deferred();
  const second=manager.start();
  const bookingB=deferred();
  let detail=null;
  const apply=async(request,promise)=>{const value=await promise;if(manager.isCurrent(request.id))detail=value};
  const a=apply(first,bookingA.promise);
  const b=apply(second,bookingB.promise);
  bookingB.resolve({reference:'SG-BBBBBBBB'});
  await b;
  bookingA.resolve({reference:'SG-AAAAAAAA'});
  await a;
  assert.deepEqual(detail,{reference:'SG-BBBBBBBB'});
});
