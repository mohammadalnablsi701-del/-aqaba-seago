import React,{useEffect,useMemo,useRef,useState}from"react";
import{AlertTriangle,CalendarDays,ChevronLeft,ChevronRight,RefreshCw,Search}from"lucide-react";
import{globalDepartures}from"./globalDeparturesApi.js";
import{createLatestRequestManager,isAbortError}from"./requestLifecycle.js";
import{filterAndSortDepartures,operationalToday,OPERATION_TIME_ZONE,salesReasonLabel,shiftOperationalDate}from"./globalDeparturesModel.js";
import"./global-departures.css";

const timeLabel=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleTimeString([],{timeZone:OPERATION_TIME_ZONE,hour:"2-digit",minute:"2-digit"})};
const dateLabel=value=>{if(!value)return"";const date=new Date(`${value}T12:00:00+03:00`);return Number.isNaN(date.getTime())?value:date.toLocaleDateString([],{timeZone:OPERATION_TIME_ZONE,weekday:"short",year:"numeric",month:"short",day:"numeric"})};
const providerStatusLabel=value=>value&&value!=="approved"?value.replaceAll("_"," "):"";

function Badge({kind="neutral",children}){return <span className={`global-departures__badge global-departures__badge--${kind}`}>{children}</span>}

export default function GlobalDepartures({token,refreshKey=0}){
  const[date,setDate]=useState(operationalToday);
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[retryKey,setRetryKey]=useState(0);
  const[providerId,setProviderId]=useState("");
  const[status,setStatus]=useState("");
  const[sales,setSales]=useState("");
  const[search,setSearch]=useState("");
  const[attentionOnly,setAttentionOnly]=useState(false);
  const managerRef=useRef(null);
  if(!managerRef.current)managerRef.current=createLatestRequestManager();

  useEffect(()=>{
    if(!token)return;
    const manager=managerRef.current;
    const request=manager.start();
    setLoading(true);
    setError("");
    globalDepartures(token,{date},{signal:request.signal}).then(value=>{
      if(manager.isCurrent(request.id))setData(value);
    }).catch(requestError=>{
      if(manager.isCurrent(request.id)&&!isAbortError(requestError))setError(requestError.message||"Could not load departures");
    }).finally(()=>{
      if(manager.isCurrent(request.id))setLoading(false);
      manager.finish(request.id);
    });
    return()=>manager.cancel();
  },[token,date,refreshKey,retryKey]);

  const providerOptions=useMemo(()=>{
    const unique=new Map();
    for(const item of data?.items||[]){if(item.providerId&&!unique.has(String(item.providerId)))unique.set(String(item.providerId),item.providerName||"Provider")}
    return [...unique.entries()].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,"en"));
  },[data]);

  const visible=useMemo(()=>filterAndSortDepartures(data?.items||[],{providerId,status,sales,search,attentionOnly}),[data,providerId,status,sales,search,attentionOnly]);
  const today=operationalToday();
  const isToday=date===today;
  const hasData=Boolean(data);
  const total=Number(data?.items?.length||0);

  return <section className="global-departures" aria-labelledby="global-departures-title">
    <div className="global-departures__head">
      <div>
        <small>DAILY OPERATIONS</small>
        <h2 id="global-departures-title">Departures</h2>
        <p>All providers for one operating day · read only · {data?.timezone||OPERATION_TIME_ZONE}</p>
      </div>
      <div className="global-departures__freshness">
        {loading&&hasData?<span><RefreshCw className="spin" size={14}/> Refreshing</span>:data?.generatedAt?<span>Updated {new Date(data.generatedAt).toLocaleTimeString([],{timeZone:OPERATION_TIME_ZONE,hour:"2-digit",minute:"2-digit"})}</span>:null}
        <button type="button" className="secondary" onClick={()=>setRetryKey(value=>value+1)} disabled={loading}><RefreshCw className={loading?"spin":""} size={14}/> Refresh</button>
      </div>
    </div>

    <div className="global-departures__datebar">
      <button type="button" className="secondary" aria-label="Previous day" onClick={()=>setDate(value=>shiftOperationalDate(value,-1))}><ChevronLeft size={16}/></button>
      <button type="button" className={isToday?"active":"secondary"} onClick={()=>setDate(today)}>Today</button>
      <label className="global-departures__date"><CalendarDays size={16}/><input type="date" value={date} onChange={event=>event.target.value&&setDate(event.target.value)}/></label>
      <button type="button" className="secondary" aria-label="Next day" onClick={()=>setDate(value=>shiftOperationalDate(value,1))}><ChevronRight size={16}/></button>
      <strong>{dateLabel(date)}</strong>
    </div>

    <div className="global-departures__filters">
      <label><span>Provider</span><select value={providerId} onChange={event=>setProviderId(event.target.value)}><option value="">All providers</option>{providerOptions.map(option=><option value={option.id} key={option.id}>{option.name}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
      <label><span>Sales</span><select value={sales} onChange={event=>setSales(event.target.value)}><option value="">Open & closed</option><option value="open">Sales Open</option><option value="closed">Sales Closed</option></select></label>
      <label className="global-departures__search"><span>Search</span><div><Search size={15}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Provider, trip, vessel"/></div></label>
      <label className="global-departures__attention"><input type="checkbox" checked={attentionOnly} onChange={event=>setAttentionOnly(event.target.checked)}/><span>Needs attention</span></label>
    </div>

    {error&&<div className="global-departures__error" role="alert"><AlertTriangle size={18}/><span>{error}{hasData?". Showing last known good data.":"."}</span><button type="button" className="secondary" onClick={()=>setRetryKey(value=>value+1)}>Retry</button></div>}
    {loading&&!hasData?<div className="global-departures__loading"><RefreshCw className="spin" size={18}/> Loading departures...</div>:null}

    {hasData&&data.truncated?<div className="global-departures__warning" role="status"><AlertTriangle size={17}/> Showing the first {data.limit||300} departures for this date.</div>:null}

    {hasData&&total===0?<div className="global-departures__empty">No departures scheduled for this date.</div>:null}
    {hasData&&total>0&&visible.length===0?<div className="global-departures__empty">No departures match the current filters.</div>:null}

    {visible.length>0?<div className="global-departures__table-wrap"><table className="global-departures__table">
      <thead><tr><th>Time</th><th>Provider</th><th>Trip / Vessel</th><th>Capacity</th><th>Reserved</th><th>Available</th><th>Check-in</th><th>Sales</th><th>Status</th></tr></thead>
      <tbody>{visible.map(item=>{
        const providerState=providerStatusLabel(item.providerStatus);
        return <tr key={item.departureId} className={(item.attentionReasons||[]).length?"needs-attention":""}>
          <td data-label="Time"><strong>{timeLabel(item.startsAt)}</strong></td>
          <td data-label="Provider"><div className="global-departures__stack"><strong>{item.providerName}</strong>{providerState?<Badge kind="warning">{providerState}</Badge>:null}</div></td>
          <td data-label="Trip / Vessel"><div className="global-departures__stack"><strong>{item.tripTitle}</strong>{item.vesselName?<span>{item.vesselName}</span>:null}<div className="global-departures__inline-badges">{!item.tripProviderActive?<Badge kind="warning">Provider paused</Badge>:null}{item.platformStatus==="paused"?<Badge kind="warning">Platform paused</Badge>:null}</div></div></td>
          <td data-label="Capacity"><strong>{item.capacity}</strong>{item.capacityInconsistent?<div><Badge kind="danger">Mismatch</Badge></div>:null}</td>
          <td data-label="Reserved"><div className="global-departures__stack"><strong>{item.reservedSeats}</strong><span>{item.confirmedSeats} confirmed</span></div></td>
          <td data-label="Available"><strong>{item.availableSeats}</strong></td>
          <td data-label="Check-in"><div className="global-departures__stack"><strong>{item.checkedInSeats} / {item.confirmedSeats}</strong><span>checked in</span></div></td>
          <td data-label="Sales"><div className="global-departures__stack">{item.salesOpen?<Badge kind="success">Sales Open</Badge>:<Badge kind="neutral">Sales Closed</Badge>}<span>{item.salesOpen?"":salesReasonLabel(item.salesReason)}</span></div></td>
          <td data-label="Status"><Badge kind={item.status==="cancelled"?"danger":item.status==="completed"?"neutral":"success"}>{item.status}</Badge></td>
        </tr>
      })}</tbody>
    </table></div>:null}
  </section>;
}
