import React,{useEffect,useRef,useState}from"react";
import{History,X,RefreshCw,ChevronLeft,ChevronRight}from"lucide-react";
import{adminAudit}from"./adminAuditApi.js";
import{createLatestRequestManager,isAbortError}from"./requestLifecycle.js";

const ACTION_LABELS={
  provider_approved:"Approved provider",
  provider_rejected:"Rejected provider",
  provider_suspended:"Suspended provider",
  provider_reactivated:"Reactivated provider",
  provider_returned_to_pending:"Returned provider to pending",
  provider_access_reset:"Reset provider access",
  trip_platform_paused:"Paused trip on platform",
  trip_platform_allowed:"Allowed trip on platform",
  commission_updated:"Updated commission"
};

function authToken(){
  try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")?.token||""}catch{return""}
}
function compact(value){
  if(value===null||value===undefined)return"—";
  if(typeof value!=="object")return String(value);
  return Object.entries(value).map(([key,item])=>`${key}: ${item===null?"null":String(item)}`).join(" · ")||"—";
}

export default function AdminActivityPanel(){
  const[open,setOpen]=useState(false);
  const[data,setData]=useState(null);
  const[page,setPage]=useState(1);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[refresh,setRefresh]=useState(0);
  const requestManager=useRef(null);
  if(!requestManager.current)requestManager.current=createLatestRequestManager();

  useEffect(()=>{
    const manager=requestManager.current;
    if(!open){manager.cancel();return;}
    const token=authToken();
    if(!token){setData(null);setLoading(false);return;}
    const request=manager.start();
    setLoading(true);setError("");
    adminAudit(token,{page,limit:25,signal:request.signal}).then(result=>{
      if(manager.isCurrent(request.id))setData(result);
    }).catch(err=>{
      if(manager.isCurrent(request.id)&&!isAbortError(err))setError(err.message||"Could not load admin activity");
    }).finally(()=>{
      if(manager.isCurrent(request.id))setLoading(false);
      manager.finish(request.id);
    });
    return()=>manager.cancel();
  },[open,page,refresh]);

  return <>
    <button className="admin-audit-launcher" type="button" onClick={()=>{setPage(1);setOpen(true)}}><History size={17}/>Admin Activity</button>
    {open&&<div className="admin-audit-backdrop" role="presentation">
      <section className="admin-audit-panel" role="dialog" aria-modal="true" aria-labelledby="admin-audit-title">
        <header><div><small>ADMIN AUDIT</small><h2 id="admin-audit-title">Admin Activity</h2><p>Append-only history of sensitive administrative actions.</p></div><div className="admin-audit-head-actions">{loading&&data&&<small>Refreshing...</small>}<button type="button" className="secondary" onClick={()=>setRefresh(v=>v+1)} disabled={loading}><RefreshCw size={15} className={loading?"spin":""}/>Refresh</button><button type="button" className="secondary" onClick={()=>setOpen(false)} aria-label="Close admin activity"><X size={18}/></button></div></header>
        {error&&<div className="error" role="alert">{error} <button type="button" className="secondary" onClick={()=>setRefresh(v=>v+1)}>Retry</button></div>}
        {loading&&!data?<div className="admin-audit-loading"><RefreshCw className="spin" size={18}/>Loading activity...</div>:<div className="admin-audit-list">{(data?.items||[]).length?(data.items.map(item=><article className="admin-audit-row" key={item._id}>
          <div className="admin-audit-time"><b>{new Date(item.createdAt).toLocaleString()}</b><span>{item.actorName||item.actorEmail||"Admin"}</span><small>{item.actorEmail||""}</small></div>
          <div className="admin-audit-action"><b>{ACTION_LABELS[item.action]||item.action}</b><span>{item.entityLabel||item.entityType} · {String(item.entityId||"")}</span>{item.reason&&<p><strong>Reason:</strong> {item.reason}</p>}</div>
          <div className="admin-audit-change"><span><strong>Before</strong>{compact(item.before)}</span><span><strong>After</strong>{compact(item.after)}</span></div>
        </article>)):<div className="admin-empty"><History size={28}/><b>No admin activity yet</b><span>Sensitive admin actions will appear here.</span></div>}</div>}
        <footer><span>{data?`${data.total||0} event${Number(data.total||0)===1?"":"s"}`:""}</span><div><button type="button" className="secondary" disabled={loading||page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><ChevronLeft size={15}/>Previous</button><span>Page {data?.page||page} of {data?.pages||1}</span><button type="button" className="secondary" disabled={loading||!data||page>=data.pages} onClick={()=>setPage(p=>p+1)}>Next<ChevronRight size={15}/></button></div></footer>
      </section>
    </div>}
  </>;
}

export{ACTION_LABELS};
