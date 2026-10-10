import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createTicketsRefreshController,
  getTicketsPollDelay,
  shouldPollTickets,
  TICKETS_POLL_INTERVAL_MS
} from "../customer-app/src/ticketsRefresh.js";
import { deriveCustomerTicketState } from "../customer-app/src/ticketLifecycle.js";

const appSource = fs.readFileSync(new URL("../customer-app/src/App.jsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../customer-app/src/api.js", import.meta.url), "utf8");
const cancellationSource = fs.readFileSync(new URL("../customer-app/src/cancellationUi.js", import.meta.url), "utf8");
const ticketsSource = appSource.slice(appSource.indexOf("function TicketsScreen"), appSource.indexOf("function ProfileScreen"));

const ready = (id="ready") => ({ _id:id, ticketPresentation:{ state:"ready", ready:true } });
const terminal = state => ({ _id:state, ticketPresentation:{ state, ready:false } });
const deferred = () => { let resolve; let reject; const promise=new Promise((res,rej)=>{resolve=res;reject=rej;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(sequence = []) {
  const calls=[];
  const data=[];
  const errors=[];
  const timers=[];
  let visible=true;
  let clock=10000;
  let index=0;
  const controller=createTicketsRefreshController({
    loadTickets:({signal,reason})=>{
      calls.push({signal,reason});
      const next=sequence[Math.min(index++, Math.max(0,sequence.length-1))];
      if (typeof next === "function") return next({signal,reason});
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? []);
    },
    onData:rows=>data.push(rows),
    onError:(error,meta)=>errors.push({error,meta}),
    isVisible:()=>visible,
    scheduleTimeout:(fn,delay)=>{const token={fn,delay,cancelled:false};timers.push(token);return token;},
    cancelTimeout:token=>{token.cancelled=true;},
    now:()=>clock
  });
  return {
    controller,calls,data,errors,timers,
    setVisible:value=>{visible=value;},
    advance:ms=>{clock+=ms;},
    latestTimer:()=>timers.at(-1)
  };
}

test("A) entering Tickets screen loads tickets once", async()=>{
  const h=harness([[ready()]]);
  await h.controller.start();
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].reason,"entry");
});

test("B) no unconditional request every 5 seconds",()=>{
  assert.equal(ticketsSource.includes("setInterval(refreshSilently,5000)"),false);
  assert.equal(ticketsSource.includes("refreshSilently"),false);
  assert.equal(TICKETS_POLL_INTERVAL_MS,30000);
});

test("C) leaving Tickets stops refresh and polling",async()=>{
  const h=harness([[ready()]]);
  await h.controller.start();
  assert.equal(h.controller.snapshot().polling,true);
  h.controller.stop();
  assert.equal(h.controller.snapshot().polling,false);
  assert.equal(h.latestTimer().cancelled,true);
});

test("D) hidden/background document does not poll",async()=>{
  const h=harness([[ready()]]);
  await h.controller.start();
  h.setVisible(false);
  await h.controller.handleVisibility(false);
  assert.equal(h.controller.snapshot().polling,false);
  assert.equal(h.latestTimer().cancelled,true);
});

test("E) returning visible triggers one refresh",async()=>{
  const h=harness([[ready("a")],[ready("b")]]);
  await h.controller.start();
  h.setVisible(false);
  await h.controller.handleVisibility(false);
  h.setVisible(true);
  h.advance(1100);
  await h.controller.handleVisibility(true);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[1].reason,"visible");
});

test("F) focus plus visibility is deduped",async()=>{
  const h=harness([[ready("a")],[ready("b")]]);
  await h.controller.start();
  h.advance(1100);
  await h.controller.refreshForeground("focus");
  await h.controller.refreshForeground("visible");
  assert.equal(h.calls.length,2);
  assert.match(ticketsSource,/refreshForeground\("focus"\)/);
  assert.match(ticketsSource,/visibilitychange/);
});

test("G) two close refresh triggers are single-flight",async()=>{
  const wait=deferred();
  const h=harness([()=>wait.promise]);
  const first=h.controller.start();
  await tick();
  const second=h.controller.refresh("mutation");
  assert.equal(h.calls.length,1);
  wait.resolve([ready()]);
  await Promise.all([first,second]);
  assert.equal(h.calls.length,1);
});

test("H) latest request wins after a hidden generation invalidates an old request",async()=>{
  const old=deferred();
  const fresh=deferred();
  const h=harness([()=>old.promise,()=>fresh.promise]);
  const first=h.controller.start();
  await tick();
  h.setVisible(false);
  await h.controller.handleVisibility(false);
  h.setVisible(true);
  h.advance(1100);
  const second=h.controller.handleVisibility(true);
  await tick();
  fresh.resolve([terminal("checked_in")]);
  await second;
  old.resolve([ready("stale")]);
  await first;
  assert.equal(h.data.length,1);
  assert.equal(h.data[0][0].ticketPresentation.state,"checked_in");
});

test("I) background refresh failure preserves last-known-good tickets",async()=>{
  const h=harness([[ready("good")],new Error("offline")]);
  await h.controller.start();
  await h.controller.refresh("poll");
  assert.equal(h.data.length,1);
  assert.equal(h.data[0][0]._id,"good");
  assert.equal(h.errors.at(-1).meta.hasData,true);
  assert.equal(h.latestTimer().delay,60000);
});

test("J) cancellation success still forces immediate Tickets truth refresh without waiting for poll",()=>{
  assert.match(cancellationSource,/dispatchEvent\(new Event\("focus"\)\)/);
  assert.match(ticketsSource,/event\?\.isTrusted===false\?refresher\.refresh\("mutation"\)/);
});

test("K) paid booking can enter Tickets and receives entry refresh",()=>{
  assert.match(appSource,/onClick=\{onViewTicket\}>Open my ticket/);
  assert.match(appSource,/setActive\("tickets"\)/);
  assert.match(ticketsSource,/refresher\.start\(ticketsRef\.current\)/);
});

test("L) Ready Ticket conditionally refreshes to Checked in",async()=>{
  const h=harness([[ready()],[terminal("checked_in")]]);
  await h.controller.start();
  assert.equal(h.latestTimer().delay,30000);
  h.latestTimer().fn();
  await tick();
  await tick();
  assert.equal(h.data.at(-1)[0].ticketPresentation.state,"checked_in");
  assert.equal(h.controller.snapshot().polling,false);
});

test("M) checked-in historical ticket does not poll",async()=>{
  const h=harness([[terminal("checked_in")]]);
  await h.controller.start();
  assert.equal(h.controller.snapshot().polling,false);
});

test("N) cancelled and refunded tickets do not poll",()=>{
  assert.equal(shouldPollTickets([terminal("booking_cancelled")]),false);
  assert.equal(shouldPollTickets([terminal("refunded")]),false);
});

test("O) departure-cancelled and completed lifecycle states stop polling",()=>{
  assert.equal(shouldPollTickets([terminal("departure_cancelled")]),false);
  assert.equal(shouldPollTickets([terminal("trip_completed")]),false);
});

test("P) Task 4 lifecycle parity remains fail-closed",()=>{
  assert.equal(deriveCustomerTicketState({ticketLifecycle:{state:"ready",usable:true,used:false}}).ready,true);
  assert.equal(deriveCustomerTicketState({ticketLifecycle:{state:"ready",usable:false,used:false}}).ready,false);
});

test("Q) Task 5 cancellation UX bridge remains wired",()=>{
  assert.match(cancellationSource,/onTruthChanged: success/);
  assert.match(cancellationSource,/queueSync\(true\)/);
});

test("R) Task 1 platform pause remains present",()=>{
  assert.match(appSource,/platformPaused/);
});

test("S) Task 2 Payment DTO consumer remains status and bookingId oriented",()=>{
  assert.match(appSource,/payment\?\.status/);
  assert.match(appSource,/payment\?\.bookingId/);
});

test("T) Task 3 pricing truth remains wired",()=>{
  assert.match(appSource,/pricingViewFromQuote/);
  assert.match(appSource,/formatServerMoney/);
});

test("U) Task 7 build isolation remains environment-driven",()=>{
  assert.match(apiSource,/import\.meta\.env\.VITE_API_BASE_URL/);
});

test("V) Task 8 vessel stabilization remains declarative",()=>{
  assert.match(appSource,/function VesselName/);
  assert.equal(appSource.includes("MutationObserver"),false);
});

test("conditional polling cadence backs off and caps after failures",()=>{
  assert.equal(getTicketsPollDelay(0),30000);
  assert.equal(getTicketsPollDelay(1),60000);
  assert.equal(getTicketsPollDelay(2),120000);
  assert.equal(getTicketsPollDelay(9),120000);
});
