import React,{useEffect,useState} from "react";
import {Activity,RefreshCw,ShieldCheck,AlertTriangle} from "lucide-react";
import {assistantMetrics} from "./api.js";

const n=v=>Number(v||0).toLocaleString("en-US");
const latency=v=>v===null||v===undefined?"—":typeof v==="string"?v+" ms":n(v)+" ms";
export default function AssistantQualityPanel({token}){
  const [snapshot,setSnapshot]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    let active=true,controller=null;
    async function load(){
      controller?.abort();controller=new AbortController();
      const signal=controller.signal;
      setBusy(true);
      try{
        const data=await assistantMetrics(token,{signal});
        if(active&&!signal.aborted){setSnapshot(data);setError("");}
      }catch(e){
        if(active&&!signal.aborted)setError(e.message||"Assistant telemetry could not be loaded.");
      }finally{if(active&&!signal.aborted)setBusy(false);}
    }
    if(token)load();
    const timer=setInterval(()=>{if(token)load();},30000);
    return()=>{active=false;clearInterval(timer);controller?.abort();};
  },[token,reload]);
  const hours=(snapshot?.hourly||[]).slice(-12);
  const peak=Math.max(1,...hours.map(h=>Number(h.requests||0)));
  return <div className="assistant-quality">
    <div className="title"><Activity/><div><small>PROVIDER ASSISTANT · V3.1</small><h1>AI quality monitoring</h1><p>Anonymous operational metrics, refreshed every 30 seconds.</p></div></div>
    <section className="assistant-quality-note"><ShieldCheck size={18}/><span>No user names, provider identifiers, prompts, chat transcripts, audio, or IP addresses are recorded. Counts are from this API process only; they reset on restart and are not historical analytics.</span></section>
    <button className="assistant-quality-refresh" type="button" onClick={()=>setReload(v=>v+1)} disabled={busy}><RefreshCw size={15} className={busy?"spin":""}/> Refresh metrics</button>
    {error&&<div className="error" role="alert"><AlertTriangle size={16}/> {error}</div>}
    {!snapshot&&!error&&<p className="muted">Loading assistant metrics...</p>}
    {snapshot&&<>
      <div className="assistant-quality-grid">
        <article><small>Requests · 24h</small><strong>{n(snapshot.totalRequests)}</strong><span>Text {n(snapshot.byMode?.text)} · Voice {n(snapshot.byMode?.audio)}</span></article>
        <article><small>Successful responses</small><strong>{snapshot.successRate===null?"—":snapshot.successRate+"%"}</strong><span>{n(snapshot.successfulRequests)} successful requests</span></article>
        <article><small>HTTP failures</small><strong>{n(snapshot.serverErrors)}</strong><span>Rate limits {n(snapshot.rateLimited)} · Client errors {n(snapshot.clientErrors)}</span></article>
        <article><small>Latency · average</small><strong>{latency(snapshot.latency?.averageMs)}</strong><span>p95 bound {latency(snapshot.latency?.p95UpperMs)}</span></article>
      </div>
      <section className="assistant-quality-chart">
        <div className="assistant-quality-chart-title"><h2>Requests by hour</h2><span>Last 12 hours · UTC</span></div>
        <div className="assistant-quality-bars" aria-label="Assistant requests in last 12 UTC hours">
          {hours.map(h=><div key={h.hour} className="assistant-quality-bar" title={h.hour+": "+h.requests+" requests, "+h.serverErrors+" HTTP server failures"}>
            <span>{h.requests||""}</span><div className="assistant-quality-bar-track"><div style={{height:(100*(h.requests||0)/peak)+"%"}}/></div><small>{h.hour.slice(11,13)}</small>
          </div>)}
        </div>
      </section>
      <section className="assistant-quality-breakdown">
        <h2>Model connectivity</h2>
        <div><span>Gemini upstream error attempts</span><b>{n(snapshot.upstream?.attemptErrors)}</b></div>
        <div><span>HTTP 503 overload attempts</span><b>{n(snapshot.upstream?.byReason?.["503"])}</b></div>
        <div><span>HTTP 429 quota / rate-limit attempts</span><b>{n(snapshot.upstream?.byReason?.["429"])}</b></div>
        <div><span>Network errors</span><b>{n(snapshot.upstream?.byReason?.network)}</b></div>
        <div><span>Local requests (without Gemini)</span><b>{n(snapshot.bySource?.local)}</b></div>
        <div><span>Gemini-routed requests</span><b>{n(snapshot.bySource?.gemini)}</b></div>
      </section>
      <p className="assistant-quality-footnote">Metrics start: {new Date(snapshot.processStartedAt).toLocaleString()} · Updated: {new Date(snapshot.generatedAt).toLocaleString()}. An upstream attempt can fail then recover on retry; its count is not the number of user-visible failures. A successful HTTP response does not prove the answer was factually correct.</p>
    </>}
  </div>;
}
