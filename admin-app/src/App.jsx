import React,{useEffect,useState}from"react";
import{Percent,RefreshCw,Save,RotateCcw,LogOut,CheckCircle2,XCircle,ShipWheel,UsersRound}from"lucide-react";
import{login,providers,approveProvider,setProviderStatus,trips,setCommission,refunds,notifications,readiness,demoCleanupPreview,cleanupDemo}from"./api.js";

function stored(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}

function Login({onDone}){
  const[email,setEmail]=useState("");const[password,setPassword]=useState("");const[error,setError]=useState("");
  async function submit(e){e.preventDefault();setError("");try{const r=await login(email.trim(),password);if(r.user?.role!=="admin")throw new Error("Admin account required");localStorage.setItem("seago_admin_auth",JSON.stringify(r));onDone(r)}catch(e){setError(e.message)}}
  return <div className="login"><form onSubmit={submit}><h1>Aqaba SeaGo Admin</h1><p>Admin access only</p><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/>{error&&<div className="error">{error}</div>}<button>Sign in</button></form></div>
}

export default function App(){
  const[auth,setAuth]=useState(stored());const[providerRows,setProviderRows]=useState([]);const[rows,setRows]=useState([]);const[refundRows,setRefundRows]=useState([]);const[notificationRows,setNotificationRows]=useState([]);const[ready,setReady]=useState(null);const[demoPreview,setDemoPreview]=useState(null);const[cleanupText,setCleanupText]=useState("");const[cleanupBusy,setCleanupBusy]=useState(false);const[cleanupMsg,setCleanupMsg]=useState("");const[tab,setTab]=useState("commissions");const[loading,setLoading]=useState(false);const[error,setError]=useState("");
  useEffect(()=>{
    const expired=()=>{setAuth(null);setProviderRows([]);setRows([]);setRefundRows([]);setNotificationRows([]);setError("Your session expired. Please sign in again.");};
    window.addEventListener("seago:session-expired",expired);
    return()=>window.removeEventListener("seago:session-expired",expired);
  },[]);
  async function load(){if(!auth?.token)return;setLoading(true);setError("");try{const[p,t,r,n,rd,dp]=await Promise.all([providers(auth.token),trips(auth.token),refunds(auth.token),notifications(auth.token),readiness(auth.token),demoCleanupPreview(auth.token)]);setProviderRows(p);setRows(t);setRefundRows(r);setNotificationRows(n);setReady(rd);setDemoPreview(dp)}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[auth?.token]);
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
  function signOut(){localStorage.removeItem("seago_admin_auth");setAuth(null);setProviderRows([]);setRows([]);setRefundRows([]);setNotificationRows([]);}
  return <div className="app"><header><div><b>Aqaba SeaGo</b><span>Admin Dashboard</span></div><div className="admin-head-actions"><button onClick={load}><RefreshCw size={16}/> Refresh</button><button onClick={signOut}><LogOut size={16}/> Sign out</button></div></header><main>
    <div className="admin-tabs"><button className={tab==="readiness"?"active":""} onClick={()=>setTab("readiness")}>Pilot readiness</button><button className={tab==="providers"?"active":""} onClick={()=>setTab("providers")}>Providers{providerRows.filter(p=>p.status==="pending").length?` (${providerRows.filter(p=>p.status==="pending").length})`:""}</button><button className={tab==="commissions"?"active":""} onClick={()=>setTab("commissions")}>Commissions</button><button className={tab==="refunds"?"active":""} onClick={()=>setTab("refunds")}>Cancellations & refunds</button><button className={tab==="notifications"?"active":""} onClick={()=>setTab("notifications")}>Email notifications</button></div>
    {error&&<div className="error">{error}</div>}
    {loading?<p>Loading...</p>:tab==="readiness"?<>
      <div className="title"><ShipWheel/><div><small>PILOT</small><h1>Pilot readiness</h1><p>Operational checks before inviting the first real provider and customers.</p></div></div>
      {ready&&<div className={"controlled-pilot-card "+(ready.controlledPilotReady?"ready":"blocked")}><div><small>CONTROLLED PILOT</small><h2>{ready.controlledPilotReady?"Ready for first real test":"Not ready yet"}</h2><p>{ready.controlledPilotReady?"Use one approved provider and one real customer. Payment remains test-only and no real money is charged.":"Complete the required readiness checks below before inviting a real customer."}</p></div><div className="controlled-pilot-actions"><a href="../provider/" target="_blank" rel="noreferrer">Open Provider App</a><a href="../" target="_blank" rel="noreferrer">Open Customer App</a></div>{ready.environment?.mockCheckout&&<em>Test payment mode · no real charge</em>}</div>}
{ready&&<div className="readiness-grid">
        <div className={"pilot-status "+(ready.pilotReady?"ready":"blocked")}><div><b>{ready.pilotReady?"Pilot ready":"Pilot blocked"}</b><span>{ready.pilotReady?"All required pilot checks passed. Deferred items can be completed later.":`${ready.blockers?.length||0} required check${(ready.blockers?.length||0)===1?"":"s"} still need attention.`}</span></div><em>{ready.deferredChecks?.length||0} deferred</em></div>
        {!ready.pilotReady&&ready.blockers?.length>0&&<div className="pilot-blockers"><b>Before pilot</b>{ready.blockers.map(x=><span key={x.id}>{x.label}</span>)}</div>}
        <div className="readiness-summary"><div><b>{ready.counts.providersApproved}</b><span>Approved providers</span></div><div><b>{ready.counts.activeTrips}</b><span>Active trips</span></div><div><b>{ready.counts.upcomingDepartures}</b><span>Upcoming departures</span></div><div><b>{ready.counts.confirmedBookings}</b><span>Confirmed bookings</span></div></div>
        <div className="readiness-checks">{ready.checks.map(x=><div key={x.id} className={"readiness-check "+(x.ok?"ok":x.deferred?"deferred":"bad")}>{x.ok?<CheckCircle2 size={18}/>:<XCircle size={18}/>}<span><b>{x.label}</b>{x.deferred&&!x.ok&&<small>Deferred for now</small>}</span></div>)}</div>
        <div className="readiness-env"><b>Environment</b><span>Public launch: {String(ready.environment.publicLaunch)}</span><span>Demo seed: {String(ready.environment.seedDemoData)}</span><span>Mock checkout: {String(ready.environment.mockCheckout)}</span><span>Payment provider: {ready.environment.paymentProvider}</span></div>
        <div className="demo-preview"><b>Demo cleanup</b><p>The preview below is read-only until you type the exact confirmation phrase.</p><span>Demo provider: {demoPreview?.provider?"Found":"Not found"}</span><span>Demo trips: {demoPreview?.trips?.length||0}</span><span>Demo active trips: {ready?.demo?.activeTripCount||0}</span><span>Demo departures: {demoPreview?.departureCount||0}</span><span>Demo users: {demoPreview?.users?.length||0}</span><span>Bookings linked to demo: {demoPreview?.bookingCount||0}</span><span>Checkout holds linked to demo: {demoPreview?.holdCount||0}</span>{demoPreview?.provider&&<div className="demo-cleanup-control"><small>{demoPreview?.safeToDelete?"Safe to delete demo provider data":(ready?.demo?.activeTripCount||0)===0?"Demo history is preserved and all demo trips are inactive. It no longer blocks the pilot.":"Cleanup is blocked because demo booking/hold history exists. Retire demo inventory instead of deleting history."}</small><input value={cleanupText} onChange={e=>setCleanupText(e.target.value)} placeholder="Type DELETE DEMO DATA"/><button disabled={!demoPreview?.safeToDelete||cleanupText!=="DELETE DEMO DATA"||cleanupBusy} onClick={runDemoCleanup}>{cleanupBusy?"Deleting demo data...":"Delete demo data"}</button>{cleanupMsg&&<em>{cleanupMsg}</em>}</div>}</div>
      </div>}
    </>:tab==="providers"?<>
      <div className="title"><UsersRound/><div><small>PROVIDERS</small><h1>Provider applications</h1><p>Review new SeaGo partners and approve them before they can publish trips.</p></div></div>
      <div className="provider-admin-list">{providerRows.length?providerRows.map(p=><ProviderAdminRow key={p._id} p={p} token={auth.token} onSaved={load}/>):<p>No provider applications yet.</p>}</div>
    </>:tab==="commissions"?<>
      <div className="title"><Percent/><div><small>COMMISSIONS</small><h1>Trip commission control</h1><p>Only admin can change SeaGo commission. Provider apps cannot edit this value.</p></div></div>
      <div className="list">{rows.map(t=><TripRow key={t._id} t={t} token={auth.token} onSaved={load}/>)}</div>
    </>:tab==="refunds"?<>
      <div className="title"><RotateCcw/><div><small>REFUNDS</small><h1>Cancellations & refunds</h1><p>Track customer and provider cancellations, refund percentages and payment status.</p></div></div>
      <div className="refund-list">{refundRows.length?refundRows.map(r=><RefundRow key={r._id} r={r}/>):<p>No cancellations yet.</p>}</div>
    </>:<>
      <div className="title"><RotateCcw/><div><small>EMAIL</small><h1>Email notifications</h1><p>Delivery history for confirmations, cancellations and trip reminders.</p></div></div>
      <div className="notification-list">{notificationRows.length?notificationRows.map(n=><NotificationRow key={n._id} n={n}/>):<p>No email events yet.</p>}</div>
    </>}
  </main></div>
}

function ProviderAdminRow({p,token,onSaved}){const[busy,setBusy]=useState(false);const[msg,setMsg]=useState("");async function approve(){setBusy(true);setMsg("");try{await approveProvider(token,p._id);setMsg("Approved");await onSaved()}catch(e){setMsg(e.message)}finally{setBusy(false)}}async function change(status){setBusy(true);setMsg("");try{await setProviderStatus(token,p._id,status);setMsg("Updated");await onSaved()}catch(e){setMsg(e.message)}finally{setBusy(false)}}const u=p.ownerUserId||{};return <div className="provider-admin-row"><div><div className="provider-admin-head"><h3>{p.businessName}</h3><em className={"provider-state "+p.status}>{p.status}</em></div><p>{u.name||"Provider"} · {u.email||"-"}</p><p>{p.phone||u.phone||"No phone"}</p><small>Applied {p.createdAt?new Date(p.createdAt).toLocaleString():"-"}</small></div><div className="provider-admin-actions">{p.status==="pending"&&<><button disabled={busy} onClick={approve}>{busy?"Working...":"Approve provider"}</button><button className="danger" disabled={busy} onClick={()=>change("rejected")}>Reject</button></>}{p.status==="approved"&&<button className="danger" disabled={busy} onClick={()=>change("suspended")}>Suspend</button>}{p.status==="suspended"&&<><button disabled={busy} onClick={()=>change("approved")}>Reactivate</button><button className="danger" disabled={busy} onClick={()=>change("rejected")}>Reject</button></>}{p.status==="rejected"&&<button className="secondary" disabled={busy} onClick={()=>change("pending")}>Return to pending</button>}{msg&&<small>{msg}</small>}</div></div>}

function TripRow({t,token,onSaved}){
  const[value,setValue]=useState(t.pricing?.commissionType==="percentage"?t.pricing?.commissionValue:0);const[saving,setSaving]=useState(false);const[msg,setMsg]=useState("");
  async function save(){setSaving(true);setMsg("");try{await setCommission(token,t._id,Number(value));setMsg("Saved");await onSaved()}catch(e){setMsg(e.message)}finally{setSaving(false)}}
  return <div className="trip"><div><h3>{t.titleEn}</h3><p>{t.providerId?.businessName||"Provider"} · {t.pricing?.pricePerPerson} JOD/person</p></div><div className="commission"><label>SeaGo commission<input type="number" min="0" max="100" step="0.1" value={value} onChange={e=>setValue(e.target.value)}/><span>%</span></label><button onClick={save} disabled={saving}><Save size={15}/>{saving?"Saving":"Save"}</button>{msg&&<small>{msg}</small>}</div></div>
}

function RefundRow({r}){
  const c=r.cancellation||{};const p=r.payment||{};const departure=r.departureId?.startsAt?new Date(r.departureId.startsAt):null;
  return <div className="refund-row"><div><small>{r.bookingReference}</small><h3>{r.customerId?.name||"Customer"} · {r.tripId?.titleEn||r.tripId?.titleAr||"Trip"}</h3><p>{r.providerId?.businessName||"Provider"}{departure?" · "+departure.toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):""}</p><p>Source: <b>{c.source||"-"}</b>{c.reason?" · "+c.reason:""}</p></div><div className="refund-values"><b>{Number(c.refundAmount||0).toFixed(2)} {r.pricing?.currency||"JOD"}</b><span>{c.refundPercentage||0}% refund</span><em className={"refund-status "+(c.refundStatus||"none")}>{c.refundStatus||"none"}</em><small>Payment: {p.status||"n/a"}</small></div></div>
}

function NotificationRow({n}){return <div className="notification-row"><div><small>{n.type}</small><h3>{n.recipient}</h3><p>{new Date(n.createdAt).toLocaleString()}</p></div><div><em className={"notification-status "+n.status}>{n.status}</em>{n.error&&<span>{n.error}</span>}{n.externalId&&<span>{n.externalId}</span>}</div></div>}
