import test from "node:test";
import assert from "node:assert/strict";
import {recordAssistantRequest,recordAssistantUpstreamError,assistantMetricsSnapshot} from "../src/services/assistantMetrics.js";
import {createApp} from "../src/app.js";

const H=3600000;
test("V3.1 rolling telemetry records anonymous counts and histogram-bounded latency",()=>{
  const t=Math.floor(Date.now()/H)*H+1000;
  const before=assistantMetricsSnapshot({now:t});
  recordAssistantRequest({mode:"audio",source:"gemini",status:200,latencyMs:712,at:t});
  recordAssistantRequest({mode:"text",source:"local",status:503,latencyMs:1200,at:t});
  recordAssistantRequest({mode:"text",source:"unknown",status:429,latencyMs:15,at:t});
  recordAssistantUpstreamError(503,t);
  recordAssistantUpstreamError(429,t);
  recordAssistantUpstreamError("network",t);
  const after=assistantMetricsSnapshot({now:t});
  assert.equal(after.scope,"single_process");
  assert.equal(after.retentionHours,24);
  assert.equal(after.totalRequests,before.totalRequests+3);
  assert.equal(after.successfulRequests,before.successfulRequests+1);
  assert.equal(after.serverErrors,before.serverErrors+1);
  assert.equal(after.rateLimited,before.rateLimited+1);
  assert.equal(after.byMode.audio,before.byMode.audio+1);
  assert.equal(after.bySource.local,before.bySource.local+1);
  assert.equal(after.upstream.byReason["503"],before.upstream.byReason["503"]+1);
  assert.equal(after.upstream.byReason["429"],before.upstream.byReason["429"]+1);
  assert.equal(after.upstream.byReason.network,before.upstream.byReason.network+1);
  assert.equal(after.hourly.length,24);
  assert.equal(after.hourly.at(-1).hour,new Date(Math.floor(t/H)*H).toISOString());
  assert.ok(Number.isFinite(after.latency.averageMs));
  assert.ok(after.latency.p95UpperMs!==null);
});
test("V3.1 telemetry ignores untrusted source labels and never serializes request content",()=>{
  const t=Math.floor(Date.now()/H)*H+1000;
  const sensitive="customer+private@example.org / +962790000000 / SECRET-VOICE";
  recordAssistantRequest({mode:sensitive,source:sensitive,status:400,latencyMs:NaN,at:t,
    prompt:sensitive,customer:sensitive,providerId:sensitive,transcript:sensitive});
  recordAssistantUpstreamError(sensitive,t);
  const data=assistantMetricsSnapshot({now:t});
  const serialized=JSON.stringify(data);
  assert.doesNotMatch(serialized,/customer\+private|SECRET-VOICE|962790000000/);
  assert.equal(data.bySource.unknown>0,true);
  assert.equal(data.upstream.byReason.other>0,true);
  for(const k of ["userId","providerId","text","audioBase64","transcript","prompt","phone","ip"]){
    assert.equal(Object.hasOwn(data,k),false,k);
  }
});
test("V3.1 last-24-hour view expires older buckets",()=>{
  const now=Math.floor(Date.now()/H)*H+2000,old=now-28*H;
  recordAssistantRequest({at:old,source:"local"});
  const view=assistantMetricsSnapshot({now});
  assert.equal(view.hourly.length,24);
  assert.ok(!view.hourly.some(x=>new Date(x.hour).getTime()===Math.floor(old/H)*H));
});
test("V3.1 admin telemetry endpoint refuses anonymous callers without a database",async()=>{
  const app=createApp(),server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  try{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api/admin/assistant/metrics");
    assert.equal(response.status,401);
    assert.equal((await response.json()).error,"Authentication required");
  }finally{await new Promise(resolve=>server.close(resolve));}
});
