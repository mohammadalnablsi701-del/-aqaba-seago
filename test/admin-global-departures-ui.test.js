import test from"node:test";
import assert from"node:assert/strict";
import{readFileSync}from"node:fs";
import{createLatestRequestManager,isAbortError}from"../admin-app/src/requestLifecycle.js";
import{filterAndSortDepartures,shiftOperationalDate}from"../admin-app/src/globalDeparturesModel.js";

function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return{promise,resolve,reject}}
async function applyWhenCurrent(manager,request,work,state){try{const value=await work;if(manager.isCurrent(request.id)){state.data=value;state.error=""}}catch(error){if(manager.isCurrent(request.id)&&!isAbortError(error))state.error=error.message}}

test("global departures date helpers support previous and next day",()=>{
  assert.equal(shiftOperationalDate("2026-10-10",-1),"2026-10-09");
  assert.equal(shiftOperationalDate("2026-10-10",1),"2026-10-11");
  assert.equal(shiftOperationalDate("2026-03-01",-1),"2026-02-28");
});

test("global departures filters and stable operational sorting remain client-only presentation logic",()=>{
  const items=[
    {departureId:"c",startsAt:"2026-10-10T09:00:00+03:00",providerId:"2",providerName:"Bravo",tripTitle:"Zulu",vesselName:"Blue",status:"scheduled",salesOpen:true,attentionReasons:[]},
    {departureId:"b",startsAt:"2026-10-10T09:00:00+03:00",providerId:"1",providerName:"Alpha",tripTitle:"Zulu",vesselName:"Red",status:"scheduled",salesOpen:false,attentionReasons:["platform_paused"]},
    {departureId:"a",startsAt:"2026-10-10T08:00:00+03:00",providerId:"1",providerName:"Alpha",tripTitle:"Early",vesselName:"Green",status:"completed",salesOpen:false,attentionReasons:[]}
  ];
  assert.deepEqual(filterAndSortDepartures(items).map(item=>item.departureId),["a","b","c"]);
  assert.deepEqual(filterAndSortDepartures(items,{providerId:"1"}).map(item=>item.departureId),["a","b"]);
  assert.deepEqual(filterAndSortDepartures(items,{status:"completed"}).map(item=>item.departureId),["a"]);
  assert.deepEqual(filterAndSortDepartures(items,{sales:"open"}).map(item=>item.departureId),["c"]);
  assert.deepEqual(filterAndSortDepartures(items,{sales:"closed",attentionOnly:true}).map(item=>item.departureId),["b"]);
  assert.deepEqual(filterAndSortDepartures(items,{search:"blue"}).map(item=>item.departureId),["c"]);
});

test("rapid date change keeps latest response",async()=>{
  const manager=createLatestRequestManager();
  const state={data:null,error:""};
  const oldWork=deferred();
  const oldRequest=manager.start();
  const oldRun=applyWhenCurrent(manager,oldRequest,oldWork.promise,state);
  const newWork=deferred();
  const newRequest=manager.start();
  const newRun=applyWhenCurrent(manager,newRequest,newWork.promise,state);
  assert.equal(oldRequest.signal.aborted,true);
  newWork.resolve({date:"2026-10-11"});
  await newRun;
  oldWork.resolve({date:"2026-10-10"});
  await oldRun;
  assert.equal(state.data.date,"2026-10-11");
});

test("background failure preserves last good departures",async()=>{
  const manager=createLatestRequestManager();
  const state={data:{date:"2026-10-10",items:[{departureId:"1"}]},error:""};
  const work=deferred();
  const request=manager.start();
  const run=applyWhenCurrent(manager,request,work.promise,state);
  work.reject(new Error("refresh failed"));
  await run;
  assert.equal(state.data.items[0].departureId,"1");
  assert.equal(state.error,"refresh failed");
});

test("global departures UI is read-only, stale-safe, retryable and operationally compact",()=>{
  const source=readFileSync(new URL("../admin-app/src/GlobalDepartures.jsx",import.meta.url),"utf8");
  const api=readFileSync(new URL("../admin-app/src/globalDeparturesApi.js",import.meta.url),"utf8");
  assert.match(source,/createLatestRequestManager/);
  assert.match(source,/globalDepartures\(token,\{date\},\{signal:request\.signal\}\)/);
  assert.match(source,/manager\.isCurrent\(request\.id\)/);
  assert.match(source,/return\(\)=>manager\.cancel\(\)/);
  assert.doesNotMatch(source,/setData\(null\)/);
  assert.match(source,/Showing last known good data/);
  assert.match(source,/>Retry<\/button>/);
  assert.match(source,/No departures scheduled for this date\./);
  for(const column of ["Time","Provider","Trip / Vessel","Capacity","Reserved","Available","Check-in","Sales","Status"])assert.match(source,new RegExp(`>${column}<`));
  assert.match(source,/checkedInSeats} \/ {item\.confirmedSeats}/);
  assert.match(source,/item\.confirmedSeats} confirmed/);
  assert.match(source,/Needs attention/);
  assert.match(source,/All providers/);
  assert.match(api,/\/api\/admin\/operations\/departures/);
  assert.doesNotMatch(api,/method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']/i);
});
