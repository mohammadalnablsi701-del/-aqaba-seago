// Anonymous, process-local rolling assistant metrics.
// Never store user/provider IDs, request text/audio, transcripts, prompt, IP or secrets.
// On process restart or multiple instances this view resets/is instance-local.
const HOUR=60*60*1000,KEEP=24;
const LATENCY_BOUNDARIES=[250,500,1000,2000,5000,10000,20000,40000,60000];
const ALLOWED_SOURCES=new Set(["local","gemini","unknown"]);
const ALLOWED_MODES=new Set(["text","audio"]);
const ALLOWED_UPSTREAM=new Set(["429","500","502","503","504","network","other"]);
const startTime=new Date().toISOString();
const buckets=new Map();
function makeBucket(start){
  return {start,requests:0,success:0,failed:0,clientErrors:0,rateLimited:0,
    byMode:{text:0,audio:0},bySource:{local:0,gemini:0,unknown:0},
    latency:{count:0,sumMs:0,maxMs:0,histogram:Array(LATENCY_BOUNDARIES.length+1).fill(0)},
    upstream:{attemptErrors:0,byReason:{"429":0,"500":0,"502":0,"503":0,"504":0,network:0,other:0}}};
}
function bucket(at){
  const now=Number.isFinite(at)?at:Date.now(),slot=Math.floor(now/HOUR)*HOUR;
  let b=buckets.get(slot);
  if(!b){b=makeBucket(slot);buckets.set(slot,b);}
  const newest=Math.max(slot,...buckets.keys());
  for(const k of buckets.keys())if(k<newest-(KEEP-1)*HOUR) buckets.delete(k);
  return b;
}
export function recordAssistantRequest({mode="text",source="unknown",status=200,latencyMs=0,at=Date.now()}={}){
  const b=bucket(at),code=Number(status),elapsed=Number(latencyMs);
  b.requests++;
  if(code>=200&&code<400)b.success++;
  else if(code===429)b.rateLimited++;
  else if(code>=500)b.failed++;
  else b.clientErrors++;
  b.byMode[ALLOWED_MODES.has(mode)?mode:"text"]++;
  b.bySource[ALLOWED_SOURCES.has(source)?source:"unknown"]++;
  if(Number.isFinite(elapsed)&&elapsed>=0){
    const ms=Math.min(Math.round(elapsed),600000);
    b.latency.count++;b.latency.sumMs+=ms;b.latency.maxMs=Math.max(b.latency.maxMs,ms);
    const index=LATENCY_BOUNDARIES.findIndex(x=>ms<=x);
    b.latency.histogram[index===-1?LATENCY_BOUNDARIES.length:index]++;
  }
}
export function recordAssistantUpstreamError(reason,at=Date.now()){
  const b=bucket(at),code=String(reason);
  b.upstream.attemptErrors++;
  b.upstream.byReason[ALLOWED_UPSTREAM.has(code)?code:"other"]++;
}
export function assistantMetricsSnapshot({now=Date.now()}={}){
  const slot=Math.floor(now/HOUR)*HOUR,rows=[];
  for(let i=KEEP-1;i>=0;i--){
    const start=slot-i*HOUR;
    rows.push(buckets.get(start)||makeBucket(start));
  }
  const total={requests:0,success:0,failed:0,clientErrors:0,rateLimited:0,
    byMode:{text:0,audio:0},bySource:{local:0,gemini:0,unknown:0},
    upstream:{attemptErrors:0,byReason:{"429":0,"500":0,"502":0,"503":0,"504":0,network:0,other:0}},
    latency:{count:0,sumMs:0,maxMs:0,histogram:Array(LATENCY_BOUNDARIES.length+1).fill(0)}};
  for(const row of rows){
    for(const k of ["requests","success","failed","clientErrors","rateLimited"])total[k]+=row[k];
    for(const k of ["text","audio"])total.byMode[k]+=row.byMode[k];
    for(const k of ["local","gemini","unknown"])total.bySource[k]+=row.bySource[k];
    total.upstream.attemptErrors+=row.upstream.attemptErrors;
    for(const k of Object.keys(total.upstream.byReason))total.upstream.byReason[k]+=row.upstream.byReason[k];
    for(const k of ["count","sumMs"])total.latency[k]+=row.latency[k];
    total.latency.maxMs=Math.max(total.latency.maxMs,row.latency.maxMs);
    row.latency.histogram.forEach((n,i)=>{total.latency.histogram[i]+=n;});
  }
  const percentile=p=>{
    if(!total.latency.count)return null;
    const target=Math.ceil(total.latency.count*p);
    let accumulated=0;
    for(let i=0;i<total.latency.histogram.length;i++){
      accumulated+=total.latency.histogram[i];
      if(accumulated>=target)return i===LATENCY_BOUNDARIES.length?">60000":LATENCY_BOUNDARIES[i];
    }
    return null;
  };
  return {scope:"single_process",retentionHours:KEEP,processStartedAt:startTime,
    generatedAt:new Date(now).toISOString(),
    totalRequests:total.requests,successfulRequests:total.success,serverErrors:total.failed,
    clientErrors:total.clientErrors,rateLimited:total.rateLimited,
    successRate:total.requests?Number((100*total.success/total.requests).toFixed(1)):null,
    byMode:total.byMode,bySource:total.bySource,
    upstream:total.upstream,
    latency:{averageMs:total.latency.count?Math.round(total.latency.sumMs/total.latency.count):null,
      p50UpperMs:percentile(.5),p95UpperMs:percentile(.95),maxMs:total.latency.count?total.latency.maxMs:null,
      note:"Percentiles are upper bounds of fixed histogram buckets, not exact quantiles."},
    hourly:rows.map(r=>({hour:new Date(r.start).toISOString(),requests:r.requests,
      success:r.success,serverErrors:r.failed,rateLimited:r.rateLimited,
      upstreamErrors:r.upstream.attemptErrors}))};
}
export function assistantRequestMetrics(req,res,next){
  const started=performance.now();
  res.on("finish",()=>{
    recordAssistantRequest({
      mode:req.body?.audioBase64?"audio":"text",
      source:res.locals.assistantMetricsSource||"unknown",
      status:res.statusCode,
      latencyMs:performance.now()-started
    });
  });
  next();
}
