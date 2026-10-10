import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const write = (path, content) => fs.writeFileSync(path, content);
const assertIncludes = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`Task 9 patch guard failed: ${label}`);
};

const appPath = "customer-app/src/App.jsx";
let app = read(appPath);
const pricingImport = 'import { createQuoteRequestGate, formatServerMoney, pricingViewFromQuote, quoteMatchesSelection } from "./pricingTruth.js";';
assertIncludes(app, pricingImport, "pricing import anchor");
if (!app.includes('from "./ticketsRefresh.js"')) {
  app = app.replace(
    pricingImport,
    `${pricingImport}\nimport { createTicketsRefreshController, TICKETS_REFRESH_EVENT } from "./ticketsRefresh.js";`
  );
}

const ticketsStart = 'function TicketsScreen({ auth, onAuthenticated }) {';
const ticketsRenderAnchor = '  if(hasApi()&&!auth?.token){';
const startIndex = app.indexOf(ticketsStart);
const renderIndex = app.indexOf(ticketsRenderAnchor, startIndex);
if (startIndex < 0 || renderIndex < 0) throw new Error("Task 9 patch guard failed: TicketsScreen anchors");

const ticketsHeader = `function TicketsScreen({ auth, onAuthenticated }) {
  const [tickets,setTickets]=useState([]);
  const [loading,setLoading]=useState(Boolean(auth?.token&&hasApi()));
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  const ticketsRef=useRef([]);

  useEffect(()=>{
    if(!hasApi()||!auth?.token){
      ticketsRef.current=[];
      setTickets([]);
      setLoading(false);
      setError("");
      return;
    }

    const refresher=createTicketsRefreshController({
      loadTickets:({signal})=>listBookings(auth.token,{signal}),
      onData:rows=>{
        ticketsRef.current=rows;
        setTickets(rows);
        setError("");
      },
      onInitialLoading:next=>{
        if(next&&ticketsRef.current.length===0)setLoading(true);
        if(!next)setLoading(false);
      },
      onError:(_error,{hasData})=>{
        setError(hasData
          ? "Tickets may be out of date. We’ll refresh again when the connection is available."
          : "Could not load tickets. Please try again.");
      },
      isVisible:()=>document.visibilityState!=="hidden",
      scheduleTimeout:(fn,delay)=>window.setTimeout(fn,delay),
      cancelTimeout:id=>window.clearTimeout(id)
    });

    const onVisibilityChange=()=>refresher.handleVisibility(document.visibilityState!=="hidden");
    const onTicketTruthChanged=()=>refresher.refresh("mutation");
    document.addEventListener("visibilitychange",onVisibilityChange);
    window.addEventListener(TICKETS_REFRESH_EVENT,onTicketTruthChanged);
    refresher.start(ticketsRef.current);

    return()=>{
      document.removeEventListener("visibilitychange",onVisibilityChange);
      window.removeEventListener(TICKETS_REFRESH_EVENT,onTicketTruthChanged);
      refresher.stop();
    };
  },[auth?.token,revision]);

`;
app = app.slice(0, startIndex) + ticketsHeader + app.slice(renderIndex);

const fullError = '  if(error) return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header><div className="ticket-error-state"><div className="booking-error">{error}</div><button className="secondary-button" onClick={()=>setRevision(x=>x+1)}>Try again</button></div></div>;';
assertIncludes(app, fullError, "Tickets full error state");
app = app.replace(fullError, fullError.replace('if(error)', 'if(error&&!tickets.length)'));

const ticketHeaderTail = '</header>{!(auth?.user?.phoneNormalized||auth?.user?.phone)&&';
assertIncludes(app, ticketHeaderTail, "Tickets render error anchor");
app = app.replace(
  ticketHeaderTail,
  '</header>{error&&<div className="booking-error ticket-refresh-error">{error}</div>}{!(auth?.user?.phoneNormalized||auth?.user?.phone)&&'
);
write(appPath, app);

const apiPath = "customer-app/src/api.js";
let api = read(apiPath);
const oldListBookings = `export async function listBookings(token) {
  const rows = await request("/api/bookings", { token });
  return Array.isArray(rows) ? rows.map(applyCustomerTicketState) : rows;
}`;
assertIncludes(api, oldListBookings, "listBookings contract");
api = api.replace(oldListBookings, `export async function listBookings(token, options = {}) {
  const rows = await request("/api/bookings", { ...options, token });
  return Array.isArray(rows) ? rows.map(applyCustomerTicketState) : rows;
}`);
write(apiPath, api);

const cancellationPath = "customer-app/src/cancellationUi.js";
let cancellation = read(cancellationPath);
const cancellationImport = 'import { cancelBooking, getCancellationPolicy, listBookings } from "./api.js";';
assertIncludes(cancellation, cancellationImport, "cancellation api import");
if (!cancellation.includes('from "./ticketsRefresh.js"')) {
  cancellation = cancellation.replace(cancellationImport, `${cancellationImport}\nimport { TICKETS_REFRESH_EVENT } from "./ticketsRefresh.js";`);
}
const oldTruthChanged = `          onTruthChanged: success => {
            invalidate();
            if (success) control.remove();
            window.dispatchEvent(new Event("focus"));
            window.setTimeout(() => queueSync(true), 80);
          }`;
assertIncludes(cancellation, oldTruthChanged, "cancellation refresh bridge");
cancellation = cancellation.replace(oldTruthChanged, `          onTruthChanged: () => {
            cachedBookings = cachedBookings.filter(row => row?._id !== booking._id);
            lastLoadedAt = Date.now();
            control.remove();
            window.dispatchEvent(new CustomEvent(TICKETS_REFRESH_EVENT, {
              detail: { reason: "cancellation", bookingId: booking._id }
            }));
          }`);
write(cancellationPath, cancellation);

write("customer-app/src/ticketsRefresh.js", `export const TICKETS_REFRESH_EVENT = "seago:tickets-refresh";
export const TICKETS_POLL_INTERVAL_MS = 30000;
export const TICKETS_MAX_BACKOFF_MS = 120000;

export function shouldPollTickets(tickets) {
  return Array.isArray(tickets) && tickets.some(ticket =>
    ticket?.ticketPresentation?.state === "ready" && ticket?.ticketPresentation?.ready === true
  );
}

export function getTicketsPollDelay(failureCount = 0) {
  const failures = Math.max(0, Number(failureCount) || 0);
  return Math.min(TICKETS_POLL_INTERVAL_MS * (2 ** failures), TICKETS_MAX_BACKOFF_MS);
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export function createTicketsRefreshController({
  loadTickets,
  onData = () => {},
  onInitialLoading = () => {},
  onError = () => {},
  isVisible = () => true,
  scheduleTimeout = (fn, delay) => setTimeout(fn, delay),
  cancelTimeout = id => clearTimeout(id)
} = {}) {
  if (typeof loadTickets !== "function") throw new TypeError("loadTickets is required");

  let active = false;
  let generation = 0;
  let inFlight = null;
  let abortController = null;
  let inFlightWasInitial = false;
  let timerId = null;
  let lastTickets = [];
  let failureCount = 0;

  function clearScheduledPoll() {
    if (timerId === null) return;
    cancelTimeout(timerId);
    timerId = null;
  }

  function abortCurrent() {
    if (!inFlight && !abortController) return;
    generation += 1;
    abortController?.abort();
    abortController = null;
    inFlight = null;
    if (inFlightWasInitial) onInitialLoading(false);
    inFlightWasInitial = false;
  }

  function schedulePoll() {
    clearScheduledPoll();
    if (!active || !isVisible() || !shouldPollTickets(lastTickets)) return;
    const delay = getTicketsPollDelay(failureCount);
    timerId = scheduleTimeout(() => {
      timerId = null;
      void refresh("poll");
    }, delay);
  }

  function refresh(reason = "manual", { initial = false } = {}) {
    if (!active || !isVisible()) return Promise.resolve(null);
    if (inFlight) return inFlight;

    const sequence = ++generation;
    const requestAbortController = new AbortController();
    abortController = requestAbortController;
    inFlightWasInitial = initial;
    if (initial) onInitialLoading(true);

    const requestPromise = Promise.resolve()
      .then(() => loadTickets({ signal: requestAbortController.signal, reason }))
      .then(rows => {
        if (!active || sequence !== generation) return null;
        lastTickets = Array.isArray(rows) ? rows : [];
        failureCount = 0;
        onData(lastTickets, { reason });
        onError(null, { hasData: lastTickets.length > 0, reason, failureCount: 0 });
        schedulePoll();
        return lastTickets;
      })
      .catch(error => {
        if (!active || sequence !== generation || isAbortError(error)) return null;
        failureCount += 1;
        onError(error, { hasData: lastTickets.length > 0, reason, failureCount });
        schedulePoll();
        return null;
      })
      .finally(() => {
        if (sequence !== generation) return;
        inFlight = null;
        abortController = null;
        if (inFlightWasInitial) onInitialLoading(false);
        inFlightWasInitial = false;
      });

    inFlight = requestPromise;
    return requestPromise;
  }

  function start(initialTickets = []) {
    active = true;
    lastTickets = Array.isArray(initialTickets) ? initialTickets : [];
    failureCount = 0;
    return refresh("entry", { initial: true });
  }

  function handleVisibility(visible) {
    if (!active) return Promise.resolve(null);
    if (!visible) {
      clearScheduledPoll();
      abortCurrent();
      return Promise.resolve(null);
    }
    failureCount = 0;
    return refresh("visible");
  }

  function stop() {
    active = false;
    clearScheduledPoll();
    abortCurrent();
  }

  function snapshot() {
    return {
      active,
      polling: timerId !== null,
      inFlight: Boolean(inFlight),
      failureCount,
      ticketCount: lastTickets.length,
      mutable: shouldPollTickets(lastTickets)
    };
  }

  return { start, refresh, handleVisibility, stop, snapshot };
}
`);

write("test/customer-tickets-polling-stabilization.test.js", `import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createTicketsRefreshController,
  getTicketsPollDelay,
  shouldPollTickets,
  TICKETS_POLL_INTERVAL_MS,
  TICKETS_REFRESH_EVENT
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
  let index=0;
  const controller=createTicketsRefreshController({
    loadTickets:({signal,reason})=>{
      calls.push({signal,reason});
      const next=sequence[Math.min(index++, sequence.length-1)];
      if (typeof next === "function") return next({signal,reason});
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? []);
    },
    onData:rows=>data.push(rows),
    onError:(error,meta)=>errors.push({error,meta}),
    isVisible:()=>visible,
    scheduleTimeout:(fn,delay)=>{const token={fn,delay,cancelled:false};timers.push(token);return token;},
    cancelTimeout:token=>{token.cancelled=true;}
  });
  return {controller,calls,data,errors,timers,setVisible:value=>{visible=value;}, latestTimer:()=>timers.at(-1)};
}

test("A) entering Tickets screen loads tickets once", async()=>{
  const h=harness([[ready()]]);
  await h.controller.start();
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].reason,"entry");
});

test("B) no unconditional request every 5 seconds",()=>{
  assert.equal(ticketsSource.includes("setInterval(refreshSilently,5000)"),false);
  assert.equal(ticketsSource.includes("5000"),false);
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
  await h.controller.handleVisibility(true);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[1].reason,"visible");
});

test("F) focus and visibility do not create a duplicate storm",()=>{
  assert.match(ticketsSource,/visibilitychange/);
  assert.equal(ticketsSource.includes('addEventListener("focus"'),false);
  assert.equal(cancellationSource.includes('new Event("focus")'),false);
});

test("G) close refresh triggers are single-flight",async()=>{
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

test("H) latest request wins after an aborted generation",async()=>{
  const old=deferred();
  const fresh=deferred();
  const h=harness([()=>old.promise,()=>fresh.promise]);
  const first=h.controller.start();
  await tick();
  h.setVisible(false);
  await h.controller.handleVisibility(false);
  h.setVisible(true);
  const second=h.controller.handleVisibility(true);
  await tick();
  fresh.resolve([terminal("checked_in")]);
  await second;
  old.resolve([ready("stale")]);
  await first;
  assert.equal(h.data.length,1);
  assert.equal(h.data[0][0].ticketPresentation.state,"checked_in");
});

test("I) background refresh failure preserves last-known-good tickets and backs off",async()=>{
  const h=harness([[ready("good")],new Error("offline")]);
  await h.controller.start();
  await h.controller.refresh("poll");
  assert.equal(h.data.length,1);
  assert.equal(h.data[0][0]._id,"good");
  assert.equal(h.errors.at(-1).meta.hasData,true);
  assert.equal(h.latestTimer().delay,60000);
});

test("J) cancellation success requests immediate ticket truth refresh",()=>{
  assert.match(cancellationSource,new RegExp(TICKETS_REFRESH_EVENT.replace(":","\\:")));
  assert.match(cancellationSource,/cachedBookings = cachedBookings\.filter/);
  assert.equal(cancellationSource.includes("queueSync(true), 80"),false);
});

test("K) payment completion then entering Tickets uses entry refresh, not interval dependence",()=>{
  assert.match(appSource,/navigate\("tickets"\)/);
  assert.match(ticketsSource,/refresher\.start\(ticketsRef\.current\)/);
});

test("L) Ready Ticket can conditionally refresh to Checked in",async()=>{
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

test("O) departure-cancelled and completed lifecycle states stop polling once refreshed",()=>{
  assert.equal(shouldPollTickets([terminal("departure_cancelled")]),false);
  assert.equal(shouldPollTickets([terminal("trip_completed")]),false);
});

test("P) Task 4 lifecycle parity stays fail-closed",()=>{
  assert.equal(deriveCustomerTicketState({ticketLifecycle:{state:"ready",usable:true,used:false}}).ready,true);
  assert.equal(deriveCustomerTicketState({ticketLifecycle:{state:"ready",usable:false,used:false}}).ready,false);
});

test("Q) Task 5 cancellation bridge no longer relies on focus polling",()=>{
  assert.match(cancellationSource,/TICKETS_REFRESH_EVENT/);
  assert.equal(cancellationSource.includes('dispatchEvent(new Event("focus"))'),false);
});

test("R) Task 1 platform-pause path remains outside Tickets stabilization",()=>{
  assert.match(appSource,/platformPaused/);
});

test("S) Task 2 payment DTO consumer remains status and bookingId oriented",()=>{
  assert.match(appSource,/result\.status/);
  assert.match(appSource,/result\.bookingId/);
});

test("T) Task 3 pricing truth module remains wired",()=>{
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

test("conditional cadence and backoff are bounded",()=>{
  assert.equal(getTicketsPollDelay(0),30000);
  assert.equal(getTicketsPollDelay(1),60000);
  assert.equal(getTicketsPollDelay(2),120000);
  assert.equal(getTicketsPollDelay(9),120000);
});
`);

console.log("Customer Phase 1 Task 9 patch applied.");
