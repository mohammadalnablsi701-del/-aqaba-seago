import React,{useEffect,useRef,useState}from"react";
import{AlertTriangle,BellRing,CheckCircle2,CircleDollarSign,LifeBuoy,RefreshCw}from"lucide-react";
import{operations}from"./api.js";
import{createLatestRequestManager,isAbortError}from"./requestLifecycle.js";
import{buildQueuePreview,getAttentionCategories,hasOperationalAttention}from"./operationsAttentionModel.js";
import"./operations-attention.css";

const iconFor=id=>id==="payment"?CircleDollarSign:id==="notification"?BellRing:LifeBuoy;
const destinationLabel=destination=>destination==="support"?"Open Support":destination==="notifications"?"Open System":"";
const formatTime=value=>{if(!value)return"";const date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString([],{dateStyle:"medium",timeStyle:"short"})};

export default function OperationsAttention({token,refreshKey=0,onNavigate}){
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[retryKey,setRetryKey]=useState(0);
  const managerRef=useRef(null);
  if(!managerRef.current)managerRef.current=createLatestRequestManager();

  useEffect(()=>{
    if(!token)return;
    const manager=managerRef.current;
    const request=manager.start();
    setLoading(true);
    setError("");
    operations(token,{signal:request.signal}).then(value=>{
      if(manager.isCurrent(request.id))setData(value);
    }).catch(requestError=>{
      if(manager.isCurrent(request.id)&&!isAbortError(requestError))setError(requestError.message||"Could not load operations attention");
    }).finally(()=>{
      if(manager.isCurrent(request.id))setLoading(false);
      manager.finish(request.id);
    });
    return()=>manager.cancel();
  },[token,refreshKey,retryKey]);

  const categories=getAttentionCategories(data);
  const needsAttention=hasOperationalAttention(data);
  const preview=buildQueuePreview(data,5);
  const generatedAt=formatTime(data?.generatedAt);

  return <section className="operations-attention" aria-labelledby="operations-attention-title">
    <div className="operations-attention__head">
      <div>
        <small>OPERATIONS</small>
        <h2 id="operations-attention-title">Needs attention</h2>
        <p>Payments, delivery failures, and support signals that may need admin follow-up.</p>
      </div>
      <div className="operations-attention__freshness">
        {loading&&data?<span><RefreshCw className="spin" size={14}/> Refreshing</span>:generatedAt?<span>Updated {generatedAt}</span>:null}
      </div>
    </div>

    {error&&<div className="operations-attention__error" role="alert"><AlertTriangle size={18}/><span>{error}. Revenue and booking data remain available.</span><button type="button" className="secondary" onClick={()=>setRetryKey(value=>value+1)}>Retry</button></div>}

    {loading&&!data?<div className="operations-attention__loading"><RefreshCw className="spin" size={18}/> Loading operational attention...</div>:null}

    {data&&!needsAttention?<div className="operations-attention__clear"><CheckCircle2 size={24}/><div><b>All clear</b><span>No operational issues need attention.</span></div></div>:null}

    {data&&needsAttention?<>
      <div className="operations-attention__categories">
        {categories.map(category=>{const Icon=iconFor(category.id);return <article className={`operations-attention__category operations-attention__category--${category.id}`} key={category.id}>
          <Icon size={19}/>
          <div><b>{category.count}</b><span>{category.label}</span></div>
          {category.destination&&category.count>0?<button type="button" className="operations-attention__link" onClick={()=>onNavigate?.(category.destination)}>{destinationLabel(category.destination)}</button>:null}
        </article>})}
      </div>
      {preview.length?<div className="operations-attention__preview"><div className="operations-attention__preview-head"><b>Queue preview</b><span>Up to 5 current signals</span></div><ul>{preview.map(item=><li key={item.id}>
        <div className={`operations-attention__signal operations-attention__signal--${item.kind}`}><b>{item.title}</b>{item.details.length?<span>{item.details.join(" · ")}</span>:null}{item.time?<small>{formatTime(item.time)}</small>:null}</div>
        {item.destination?<button type="button" className="secondary" onClick={()=>onNavigate?.(item.destination)}>{destinationLabel(item.destination)}</button>:<span className="operations-attention__readonly">Read only</span>}
      </li>)}</ul></div>:null}
    </>:null}
  </section>;
}
