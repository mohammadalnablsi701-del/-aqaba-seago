import React,{useEffect,useState}from"react";
import{Percent,RefreshCw,Save,RotateCcw,LogOut,CheckCircle2,XCircle,ShipWheel,UsersRound,Bell,LifeBuoy,LayoutDashboard,Mail,ReceiptText}from"lucide-react";
import{login,providers,approveProvider,setProviderStatus,trips,setCommission,refunds,notifications,supportRequests,setSupportRequestStatus,overview,readiness,demoCleanupPreview,cleanupDemo}from"./api.js";

function AdminBrand({login=false}){return <div className={"admin-brand"+(login?" admin-brand-login":"")}><svg className="admin-brand-mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#D8DEE6" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="10.5"/>{[0,45,90,135,180,225,270,315].map(a=><line key={a} x1="32" y1="5.5" x2="32" y2="14" transform={`rotate(${a} 32 32)`}/>)}<path d="M25 33c3-4 6 3 9 2 2-.5 3.5-2 5-3"/></g></svg><div className="admin-brand-copy"><b>SeaGo</b><span>AQABA · ADMIN</span></div></div>}

function stored(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}
function ymd(date=new Date()){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");return `${y}-${m}-${d}`}
function rangeForPreset(preset){
  const today=new Date();
  if(preset==="all")return{from:"",to:""};
  if(preset==="today")return{from:ymd(today),to:ymd(today)};
  if(preset==="month")return{from:ymd(new Date(today.getFullYear(),today.getMonth(),1)),to:ymd(today)};
  const days=preset==="7d"?7:30;
  const from=new Date(today);from.setDate(today.getDate()-(days-1));
  return{from:ymd(from),to:ymd(today)};
}

function Login({onDone}) {
  const[email,setEmail]=useState("");const[password,setPassword]=useState("");const[error,setError]=useState("");const[busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError("");try{
    const r=await login(email.trim(),password);
    if(r.user?.role!=="admin")throw new Error("Admin account required");
    localStorage.setItem("seago_admin_auth",JSON.stringify(r));onDone(r)
  }catch(e){setError(e.message)}finally{setBusy(false)}}
  return <div className="login"><form onSubmit={submit}><AdminBrand login/><h1>Admin sign in</h1><p>Admin access only · email and password</p><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/>{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?"Please wait...":"Sign in"}</button></form></div>
}

export default function App(){
  const[auth,setAuth]=useState(stored());const[providerRows,setProviderRows]=useState([]);const[rows,setRows]=useState([]);const[refundRows,setRefundRows]=useState([]);const[notificationRows,setNotificationRows]=useState([]);const[supportRows,setSupportRows]=useState([]);const[emailStatus,setEmailStatus]=useState("all");const[emailType,setEmailType]=useState("all");const[ready,setReady]=useState(null);const[demoPreview,setDemoPreview]=useState(null);const[cleanupText,setCleanupText]=useState("");const[cleanupBusy,setCleanupBusy]=useState(false);const[cleanupMsg,setCleanupMsg]=useState("");const[tab,setTab]=useState("readiness");const[loading,setLoading]=useState(false);const[error,setError]=useState("");const[overviewData,setOverviewData]=useState(null);const[overviewLoading,setOverviewLoading]=useState(false);const[overviewError,setOverviewError]=useState("");const[overviewPreset,setOverviewPreset]=useState("month");const[overviewProvider,setOverviewProvider]=useState("");const initialRange=rangeForPreset("month");const[overviewFrom,setOverviewFrom]=useState(initialRange.from);const[overviewTo,setOverviewTo]=useState(initialRange.to);const[overviewRefresh,setOverviewRefresh]=useState(0);
  useEffect(()=>{
    const expired=()=>{setAuth(null);setProviderRows([]);setRows([]);setRefundRows([]);setNotificationRows([]);setSupportRows([]);setError("Your session expired. Please sign in again.");};
    window.addEventListener("seago:session-expired",expired);
    return()=>window.removeEventListener("seago:session-expired",expired);
  },[]);
  async function load(){if(!auth?.token)return;setLoading(true);setError("");try{const[p,t,r,n,s,rd,dp]=await Promise.all([providers(auth.token),trips(auth.token),refunds(auth.token),notifications(auth.token),supportRequests(auth.token),readiness(auth.token),demoCleanupPreview(auth.token)]);setProviderRows(p);setRows(t);setRefundRows(r);setNotificationRows(n);setSupportRows(s);setReady(rd);setDemoPreview(dp)}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[auth?.token]);
  useEffect(()=>{
    let ignore=false;
    if(!auth?.token)return;
    setOverviewLoading(true);setOverviewError("");
    overview(auth.token,{from:overviewFrom,to:overviewTo,providerId:overviewProvider})
      .then(r=>{if(!ignore)setOverviewData(r)})
      .catch(e=>{if(!ignore)setOverviewError(e.message||"Could not load overview")})
      .finally(()=>{if(!ignore)setOverviewLoading(false)});
    return()=>{ignore=true};
  },[auth?.token,overviewFrom,overviewTo,overviewProvider,overviewRefresh]);
  function applyOverviewPreset(preset){
    setOverviewPreset(preset);
    const next=rangeForPreset(preset);
    setOverviewFrom(next.from);setOverviewTo(next.to);
  }
  async function runDemoCleanup(){
    if(!demoPreview?.provider?.id&& !demoPreview?.provider?._id){setCleanupMsg("No demo provider found.");return;}
    setCleanupBusy(true);setCleanupMsg("");
    try{
      const providerId=demoPreview.provider.id||demoPreview.provider._id;
      const r=await cleanupDemo(auth.token,providerId,cleanupText);
      setCleanupMsg(r.message||"Cleanup complete.");
      setCleanupText("");
      await load();
    }catch(e){setCleanupMsg(e.message);}
    finally{setCleanupBusy(false);}
  }
  if(!auth)return <Login onDone={setAuth}/>;
  const emailTypes=[...new Set(notificationRows.map(n=>n.type).filter(Boolean))].sort();
  const emailCounts=notificationRows.reduce((a,n)=>{a.total++;a[n.status]=(a[n.status]||0)+1;return a},{total:0,sent:0,failed:0,skipped:0});
  const emailFiltered=notificationRows.filter(n=>(emailStatus==="all"||n.status===emailStatus)&&(emailType==="all"||n.type===emailType));
  const emailFailureSamples=notificationRows.filter(n=>n.status==="failed"&&n.error).slice(0,3);
  function signOut(){localStorage.removeItem("seago_admin_auth");setAuth(null);setProviderRows([]);setRows([]);setRefundRows([]);setNotificationRows([]);setSupportRows([]);}
  return <div className="app"><header><AdminBrand/><div className="admin-head-actions"><button onClick={()=>{load();setOverviewRefresh(v=>v+1)}} disabled={loading}><RefreshCw className={loading?"spin":""} size={16}/> {loading?"Refreshing":"Refresh"}</button><button onClick={signOut}><LogOut size={16}/> Sign out</button></div></header><main>
    <aside className="admin-tabs" aria-label="Admin navigation">
      <div className="admin-tabs__label">Workspace</div>
      <button className={tab==="readiness"?"active":""} onClick={()=>setTab("readiness")}><LayoutDashboard size={17}/><span>Overview</span></button>
      <button className={tab==="providers"?"active":""} onClick={()=>setTab("providers")}><UsersRound size={17}/><span>Providers</span>{providerRows.filter(p=>p.status==="pending").length>0&&<em>{providerRows.filter(p=>p.status==="pending").length}</em>}</button>
      <button className={tab==="commissions"?"active":""} onClick={()=>setTab("commissions")}><Percent size={17}/><span>Trips & fees</span></button>
      <button className={tab==="refunds"?"active":""} onClick={()=>setTab("refunds")}><ReceiptText size={17}/><span>Refunds</span></button>
      <button className={tab==="support"?"active":""} onClick={()=>setTab("support")}><LifeBuoy size={17}/><span>Support</span>{supportRows.filter(x=>x.status==="open").length>0&&<em>{supportRows.filter(x=>x.status==="open").length}</em>}</button>
      <button className={tab==="notifications"?"active":""} onClick={()=>setTab("notifications")}><Mail size={17}/><span>System</span></button>
    </aside>
    <section className="admin-content">
    {error&&<div className="error">{error}</div>}
    {loading?<div className="admin-loading"><RefreshCw className="spin" size={18}/> Loading dashboard...</div>:tab==="readiness"?<>
      <div className="title"><LayoutDashboard/><div><small>OVERVIEW</small><h1>Revenue & bookings</h1><p>Financial performance across all providers, with date and company filters.</p></div></div>

      <section className="overview-filter-card">
        <div className="overview-presets">
          {[
            ["today","Today"],["7d","7 days"],["30d","30 days"],["month","This month"],["all","All time"]
          ].map(([id,label])=><button key={id} className={overviewPreset===id?"active":""} onClick={()=>applyOverviewPreset(id)}>{label}</button>)}
        </div>
        <div className="overview-filter-grid">
          <label><span>Company</span><select value={overviewProvider} onChange={e=>setOverviewProvider(e.target.value)}><option value="">All companies</option>{(overviewData?.providers||providerRows).map(p=><option key={p.id||p._id} value={p.id||p._id}>{p.businessName}</option>)}</select></label>
          <label><span>From</span><input type="date" value={overviewFrom} onChange={e=>{setOverviewPreset("custom");setOverviewFrom(e.target.value)}}/></label>
          <label><span>To</span><input type="date" value={overviewTo} onChange={e=>{setOverviewPreset("custom");setOverviewTo(e.target.value)}}/></label>
        </div>
      </section>

      {overviewError&&<div className="error">{overviewError}</div>}
      {overviewLoading&&!overviewData?<div className="admin-loading"><RefreshCw className="spin" size={18}/> Loading financial overview...</div>:<>
        <section className="overview-kpis">
          <div className="overview-kpi overview-kpi--primary"><small>SeaGo income</small><b>{Number(overviewData?.totals?.seaGoIncome||0).toFixed(2)} <em>{overviewData?.currency||"JOD"}</em></b><span>After refunds</span></div>
          <div className="overview-kpi"><small>Bookings</small><b>{overviewData?.totals?.bookings||0}</b><span>Paid bookings</span></div>
          <div className="overview-kpi"><small>Guests</small><b>{overviewData?.totals?.guests||0}</b><span>Booked seats</span></div>
          <div className="overview-kpi"><small>Gross sales</small><b>{Number(overviewData?.totals?.grossSales||0).toFixed(2)} <em>{overviewData?.currency||"JOD"}</em></b><span>Before refunds</span></div>
          <div className="overview-kpi"><small>Refunds</small><b>{Number(overviewData?.totals?.refunds||0).toFixed(2)} <em>{overviewData?.currency||"JOD"}</em></b><span>Returned to customers</span></div>
          <div className="overview-kpi"><small>Net sales</small><b>{Number(overviewData?.totals?.netSales||0).toFixed(2)} <em>{overviewData?.currency||"JOD"}</em></b><span>Gross minus refunds</span></div>
          <div className="overview-kpi"><small>Provider net</small><b>{Number(overviewData?.totals?.providerNet||0).toFixed(2)} <em>{overviewData?.currency||"JOD"}</em></b><span>After refunds</span></div>
        </section>

        <section className="provider-breakdown-card">
          <div className="provider-breakdown-head"><div><small>COMPANY BREAKDOWN</small><h2>{overviewProvider?"Selected company":"All companies"}</h2></div><span>{overviewFrom&&overviewTo?`${overviewFrom} → ${overviewTo}`:"All time"}</span></div>
          <div className="provider-breakdown-table">
            <div className="provider-breakdown-row provider-breakdown-row--head"><span>Company</span><span>Bookings</span><span>Guests</span><span>Gross</span><span>Refunds</span><span>SeaGo</span><span>Provider net</span></div>
            {(overviewData?.breakdown||[]).length?(overviewData.breakdown.map(r=><div className="provider-breakdown-row" key={r.providerId}>
              <span className="provider-breakdown-name"><b>{r.providerName}</b><small>{r.providerStatus||""}</small></span>
              <span>{r.bookings}</span><span>{r.guests}</span><span>{Number(r.grossSales||0).toFixed(2)}</span><span>{Number(r.refunds||0).toFixed(2)}</span><span className="provider-breakdown-income">{Number(r.seaGoIncome||0).toFixed(2)}</span><span>{Number(r.providerNet||0).toFixed(2)}</span>
            </div>)):<div className="admin-empty"><LayoutDashboard size={28}/><b>No activity in this period</b><span>Try another date range or company.</span></div>}
          </div>
        </section>
      </>}
    </>:tab==="providers"?<>
      <div className="title"><UsersRound/><div><small>PROVIDERS</small><h1>Provider applications</h1><p>Review new SeaGo partners and approve them before they can publish trips.</p></div></div>
      <div className="provider-admin-list">{providerRows.length?providerRows.map(p=><ProviderAdminRow key={p._id} p={p} token={auth.token} onSaved={load}/>):<div className="admin-empty"><UsersRound size={28}/><b>No providers yet</b><span>New provider applications will appear here.</span></div>}</div>
    </>:tab==="commissions"?<>
      <div className="title"><Percent/><div><small>TRIPS & FEES</small><h1>Trip commission control</h1><p>Review trip performance and manage SeaGo commission from one place.</p></div></div>
      <div className="list">{rows.length?rows.map(t=><TripRow key={t._id} t={t} token={auth.token} onSaved={load}/>):<div className="admin-empty"><Percent size={28}/><b>No trips yet</b><span>Commission controls appear after a provider creates a trip.</span></div>}</div>
    </>:tab==="refunds"?<>
      <div className="title"><RotateCcw/><div><small>REFUNDS</small><h1>Cancellations & refunds</h1><p>Track customer and provider cancellations, refund percentages and payment status.</p></div></div>
      <div className="refund-list">{refundRows.length?refundRows.map(r=><RefundRow key={r._id} r={r}/>):<div className="admin-empty"><RotateCcw size={28}/><b>No cancellations</b><span>Refund activity will appear here when a booking is cancelled.</span></div>}</div>
    </>:tab==="support"?<>
      <div className="title"><LifeBuoy/><div><small>SUPPORT</small><h1>Customer support requests</h1><p>Tracked requests submitted from the SeaGo customer app.</p></div></div>
      <div className="support-admin-list">{supportRows.length?supportRows.map(r=><SupportRow key={r._id} r={r} token={auth.token} onSaved={load}/>):<div className="admin-empty"><LifeBuoy size={28}/><b>No support requests</b><span>Customer requests will appear here.</span></div>}</div>
    </>:<>
      <div className="title"><Bell/><div><small>SYSTEM</small><h1>System notifications</h1><p>Email delivery history and operational notification health.</p></div></div>
      <div className="email-summary-grid"><div><small>Total</small><b>{emailCounts.total}</b></div><div className="ok"><small>Sent</small><b>{emailCounts.sent}</b></div><div className="bad"><small>Failed</small><b>{emailCounts.failed}</b></div><div className="warn"><small>Skipped</small><b>{emailCounts.skipped}</b></div></div>
      {emailCounts.failed>0&&<div className="email-alert"><b>Email delivery needs attention</b><span>{emailCounts.failed} failed event{emailCounts.failed===1?"":"s"} detected.</span>{emailFailureSamples.map((n,i)=><small key={n._id||i}>{n.error}</small>)}</div>}
      <div className="email-filters"><select value={emailStatus} onChange={e=>setEmailStatus(e.target.value)}><option value="all">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option></select><select value={emailType} onChange={e=>setEmailType(e.target.value)}><option value="all">All types</option>{emailTypes.map(t=><option key={t} value={t}>{t}</option>)}</select><span>{emailFiltered.length} shown</span></div>
      <div className="notification-list">{emailFiltered.length?emailFiltered.map(n=><NotificationRow key={n._id} n={n}/>):<p>No email events match these filters.</p>}</div>
    </>}
    </section>
  </main></div>
}

function ProviderAdminRow({p,token,onSaved}){const[busy,setBusy]=useState(false);const[msg,setMsg]=useState("");async function approve(){setBusy(true);setMsg("");try{await approveProvider(token,p._id);setMsg("Approved");await onSaved()}catch(e){setMsg(e.message)}finally{setBusy(false)}}async function change(status){setBusy(true);setMsg("");try{await setProviderStatus(token,p._id,status);setMsg("Updated");await onSaved()}catch(e){setMsg(e.message)}finally{setBusy(false)}}const u=p.ownerUserId||{},op=p.operations||{};return <div className="provider-admin-row"><div className="provider-main"><div className="provider-admin-head"><h3>{p.businessName}</h3><em className={"provider-state "+p.status}>{p.status}</em>{p.settingsConfigured?<span className="provider-setup-ok">Setup complete</span>:<span className="provider-setup-missing">Setup incomplete</span>}</div><p>{u.name||"Provider"} · {u.email||"-"}</p><p>{p.phone||u.phone||"No phone"}</p><div className="provider-ops-grid"><div><b>{op.tripCount||0}</b><span>Trips</span></div><div><b>{op.activeTripCount||0}</b><span>Active</span></div><div><b>{op.upcomingDepartures||0}</b><span>Upcoming</span></div><div><b>{op.reservedSeatsUpcoming||0}/{op.capacityUpcoming||0}</b><span>Seats</span></div></div>{op.nextDepartureAt&&<div className="provider-next-departure"><span>Next departure</span><b>{new Date(op.nextDepartureAt).toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</b></div>}<small>Applied {p.createdAt?new Date(p.createdAt).toLocaleString():"-"}</small></div><div className="provider-admin-actions">{p.status==="pending"&&<><button disabled={busy} onClick={approve}>{busy?"Working...":"Approve provider"}</button><button className="danger" disabled={busy} onClick={()=>change("rejected")}>Reject</button></>}{p.status==="approved"&&<button className="danger" disabled={busy} onClick={()=>change("suspended")}>Suspend</button>}{p.status==="suspended"&&<><button disabled={busy} onClick={()=>change("approved")}>Reactivate</button><button className="danger" disabled={busy} onClick={()=>change("rejected")}>Reject</button></>}{p.status==="rejected"&&<button className="secondary" disabled={busy} onClick={()=>change("pending")}>Return to pending</button>}{msg&&<small>{msg}</small>}</div></div>}

function TripRow({t,token,onSaved}){
  const[value,setValue]=useState(t.pricing?.commissionType==="percentage"?t.pricing?.commissionValue:0);const[saving,setSaving]=useState(false);const[msg,setMsg]=useState("");
  async function save(){setSaving(true);setMsg("");try{await setCommission(token,t._id,Number(value));setMsg("Saved");await onSaved()}catch(e){setMsg(e.message)}finally{setSaving(false)}}
  const adultPrice=Number(t.pricing?.adultPrice??t.pricing?.pricePerPerson??0);const f=t.financials||{};const currency=f.currency||t.pricing?.currency||"JOD";
  return <div className="trip trip-financial"><div className="trip-financial-main"><div className="trip-admin-head"><h3>{t.titleEn||t.titleAr||"Untitled trip"}</h3><span className={t.active?"trip-live":"trip-off"}>{t.active?"Active":"Inactive"}</span></div><p>{t.providerId?.businessName||"Provider"} · {adultPrice.toFixed(2)} {currency}/adult</p><div className="trip-financial-grid"><div><small>Bookings</small><b>{f.confirmedBookings||0}</b></div><div><small>Seats</small><b>{f.confirmedSeats||0}</b></div><div><small>Gross sales</small><b>{Number(f.grossSales||0).toFixed(2)} {currency}</b></div><div><small>SeaGo earned</small><b>{Number(f.commissionAmount||0).toFixed(2)} {currency}</b></div><div><small>Provider net</small><b>{Number(f.providerNetAmount||0).toFixed(2)} {currency}</b></div></div></div><div className="commission"><label>SeaGo commission<input type="number" min="0" max="100" step="0.1" value={value} onChange={e=>setValue(e.target.value)}/><span>%</span></label><button onClick={save} disabled={saving}><Save size={15}/>{saving?"Saving":"Save"}</button>{msg&&<small>{msg}</small>}</div></div>
}

function RefundRow({r}){
  const c=r.cancellation||{},p=r.payment||{},impact=r.financialImpact||{};const departure=r.departureId?.startsAt?new Date(r.departureId.startsAt):null;const currency=impact.currency||r.pricing?.currency||"JOD";
  return <div className="refund-row"><div className="refund-main"><small>{r.bookingReference}</small><h3>{r.customerId?.name||"Customer"} · {r.tripId?.titleEn||r.tripId?.titleAr||"Trip"}</h3><p>{r.providerId?.businessName||"Provider"}{departure?" · "+departure.toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):""}</p><p>Source: <b>{c.source||"-"}</b>{c.reason?" · "+c.reason:""}</p><div className="refund-allocation-note">Refund is actual policy output; retained allocation is estimated until production provider payouts are enabled.</div><div className="refund-financial-grid"><div><span>Original</span><b>{Number(impact.originalAmount||0).toFixed(2)} {currency}</b></div><div><span>Refund</span><b>{Number(impact.refundAmount||0).toFixed(2)} {currency}</b></div><div><span>Retained</span><b>{Number(impact.retainedAmount||0).toFixed(2)} {currency}</b></div><div><span>Est. SeaGo retained</span><b>{Number(impact.seaGoRetained||0).toFixed(2)} {currency}</b></div><div><span>Est. provider net</span><b>{Number(impact.providerNetAfterRefund||0).toFixed(2)} {currency}</b></div></div></div><div className="refund-values"><b>{c.refundPercentage||0}% refund</b><em className={"refund-status "+(c.refundStatus||"none")}>{c.refundStatus||"none"}</em><small>Payment: {p.status||"n/a"}</small>{p.refundedAmount!=null&&<small>Gateway refunded: {Number(p.refundedAmount||0).toFixed(2)} {p.currency||currency}</small>}{p.refundReference&&<small>Ref: {p.refundReference}</small>}</div></div>
}

function NotificationRow({n}){return <div className="notification-row"><div><small>{n.type}</small><h3>{n.recipient}</h3><p>{new Date(n.createdAt).toLocaleString()}</p></div><div><em className={"notification-status "+n.status}>{n.status}</em>{n.error&&<span>{n.error}</span>}{n.externalId&&<span>{n.externalId}</span>}</div></div>}

function SupportRow({r,token,onSaved}){const[busy,setBusy]=useState(false);const[msg,setMsg]=useState("");async function change(status){setBusy(true);setMsg("");try{await setSupportRequestStatus(token,r._id,status);await onSaved()}catch(e){setMsg(e.message)}finally{setBusy(false)}}const customer=r.customerId||{};return <div className="support-admin-row"><div><small>{r.bookingReference||"GENERAL SUPPORT"} · {new Date(r.createdAt).toLocaleString()}</small><h3>{r.subject}</h3><p>{r.message}</p><span>{customer.name||"Customer"}{customer.email?" · "+customer.email:""}{customer.phone?" · "+customer.phone:""}</span></div><div><em className={"support-state "+r.status}>{String(r.status||"open").replace("_"," ")}</em><select value={r.status} disabled={busy} onChange={e=>change(e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>{msg&&<small>{msg}</small>}</div></div>}
