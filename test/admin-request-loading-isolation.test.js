import test from"node:test";
import assert from"node:assert/strict";
import{readFileSync}from"node:fs";
import{createLatestRequestManager,createSectionRequestManager,isAbortError,applySettledSectionResults}from"../admin-app/src/requestLifecycle.js";

function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return{promise,resolve,reject}}
async function applyWhenCurrent(manager,request,work,state){try{const value=await work;if(manager.isCurrent(request.id)){state.data=value;state.error=""}}catch(error){if(manager.isCurrent(request.id)&&!isAbortError(error))state.error=error.message}}

test("A secondary endpoint failure does not discard successful sections",async()=>{
  const results=await Promise.allSettled([Promise.resolve(["provider"]),Promise.reject(new Error("readiness down")),Promise.resolve(["trip"])]);
  const sections=applySettledSectionResults(results,["providers","readiness","trips"]);
  assert.equal(sections.providers.ok,true);
  assert.deepEqual(sections.providers.value,["provider"]);
  assert.equal(sections.readiness.ok,false);
  assert.equal(sections.readiness.error,"readiness down");
  assert.equal(sections.trips.ok,true);
  assert.deepEqual(sections.trips.value,["trip"]);
});

test("B background refresh failure preserves last good data",async()=>{
  const manager=createLatestRequestManager();const state={data:"last-good",error:""};const work=deferred();const request=manager.start();const run=applyWhenCurrent(manager,request,work.promise,state);work.reject(new Error("refresh failed"));await run;assert.equal(state.data,"last-good");assert.equal(state.error,"refresh failed");
});

test("D newest response wins when A resolves after B",async()=>{
  const manager=createLatestRequestManager();const state={data:null,error:""};const a=deferred();const ra=manager.start();const runA=applyWhenCurrent(manager,ra,a.promise,state);const b=deferred();const rb=manager.start();const runB=applyWhenCurrent(manager,rb,b.promise,state);b.resolve("B");await runB;a.resolve("A");await runA;assert.equal(state.data,"B");
});

test("E stale error is ignored after newer success",async()=>{
  const manager=createLatestRequestManager();const state={data:null,error:""};const a=deferred();const ra=manager.start();const runA=applyWhenCurrent(manager,ra,a.promise,state);const b=deferred();const rb=manager.start();const runB=applyWhenCurrent(manager,rb,b.promise,state);b.resolve("B");await runB;a.reject(new Error("old failure"));await runA;assert.equal(state.data,"B");assert.equal(state.error,"");
});

test("F aborted requests are recognized and do not become user errors",()=>{
  const manager=createLatestRequestManager();const first=manager.start();manager.start();assert.equal(first.signal.aborted,true);const error=new Error("aborted");error.name="AbortError";assert.equal(isAbortError(error),true);assert.equal(isAbortError(new Error("network")),false);
});

test("G cancel invalidates lifecycle so unmounted work cannot write state",()=>{
  const manager=createLatestRequestManager();const current=manager.start();manager.cancel();assert.equal(current.signal.aborted,true);assert.equal(manager.isCurrent(current.id),false);
});

test("section managers isolate cancellation by section",()=>{
  const manager=createSectionRequestManager();const providers=manager.start("providers");const trips=manager.start("trips");manager.start("providers");assert.equal(providers.signal.aborted,true);assert.equal(trips.signal.aborted,false);manager.cancelAll();assert.equal(trips.signal.aborted,true);
});

test("C initial critical load has scoped loading, error and retry UI",()=>{
  const source=readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/function SectionFeedback/);
  assert.match(source,/loading&&!loaded&&!error/);
  assert.match(source,/role="alert"/);
  assert.match(source,/>Retry<\/button>/);
});

test("dashboard uses allSettled and background refresh never replaces the whole screen",()=>{
  const source=readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/Promise\.allSettled/);
  assert.match(source,/Refreshing dashboard data/);
  assert.doesNotMatch(source,/Loading dashboard\.\.\./);
});

test("H settlements filter path is latest-only and abortable",()=>{
  const source=readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/start\("settlements"\)/);
  assert.match(source,/settlements\(auth\.token,\{from:settlementFrom,to:settlementTo,providerId:settlementProvider\},\{signal:request\.signal\}\)/);
  assert.match(source,/isCurrent\("settlements",request\.id\)/);
  assert.match(source,/settlementLoading&&settlementData/);
});

test("I refunds refresh path is latest-only and keeps scoped state",()=>{
  const source=readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/refunds:\[refunds,setRefundRows\]/);
  assert.match(source,/sectionRequests\.current\.start\(section\)/);
  assert.match(source,/SectionFeedback label="refunds"/);
});

test("overview filter path is latest-only and preserves visible data during refresh",()=>{
  const source=readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/start\("overview"\)/);
  assert.match(source,/overview\(auth\.token,\{from:overviewFrom,to:overviewTo,providerId:overviewProvider\},\{signal:request\.signal\}\)/);
  assert.match(source,/overviewLoading&&overviewData/);
});

test("J Admin Activity pagination refresh is abortable and stale-safe",()=>{
  const source=readFileSync(new URL("../admin-app/src/AdminActivityPanel.jsx",import.meta.url),"utf8");
  assert.match(source,/createLatestRequestManager/);
  assert.match(source,/signal:request\.signal/);
  assert.match(source,/manager\.isCurrent\(request\.id\)/);
  assert.match(source,/return\(\)=>manager\.cancel\(\)/);
});

test("K demo cleanup preview and readiness retries are section-scoped",()=>{
  const source=readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/onRetry=\{\(\)=>retry\("readiness"\)\}/);
  assert.match(source,/onRetry=\{\(\)=>retry\("demo"\)\}/);
  assert.match(source,/demo:\[demoCleanupPreview,setDemoPreview\]/);
});

test("API layer forwards AbortSignal without changing endpoint contracts",()=>{
  const api=readFileSync(new URL("../admin-app/src/api.js",import.meta.url),"utf8");
  const audit=readFileSync(new URL("../admin-app/src/adminAuditApi.js",import.meta.url),"utf8");
  assert.match(api,/providers=\(token,options=\{\}\)=>req\("\/api\/admin\/providers",\{token,\.\.\.options\}\)/);
  assert.match(api,/overview=\(token,\{from="",to="",providerId=""\}=\{\},options=\{\}\)/);
  assert.match(audit,/signal,/);
});
