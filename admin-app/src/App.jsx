import React,{useEffect,useState}from"react";
import{Percent,RefreshCw,Save,RotateCcw,LogOut}from"lucide-react";
import{login,trips,setCommission,refunds,notifications}from"./api.js";

function stored(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}

function Login({onDone}){
  const[email,setEmail]=useState("");const[password,setPassword]=useState("");const[error,setError]=useState("");
  async function submit(e){e.preventDefault();setError("");try{const r=await login(email.trim(),password);if(r.user?.role!=="admin")throw new Error("Admin account required");localStorage.setItem("seago_admin_auth",JSON.stringify(r));onDone(r)}catch(e){setError(e.message)}}
  return <div className="login"><form onSubmit={submit}><h1>Aqaba SeaGo Admin</h1><p>Admin access only</p><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/>{error&&<div className="error">{error}</div>}<button>Sign in</button></form></div>
}

export default function App(){
  const[auth,setAuth]=useState(stored());const[rows,setRows]=useState([]);const[refundRows,setRefundRows]=useState([]);const[notificationRows,setNotificationRows]=useState([]);const[tab,setTab]=useState("commissions");const[loading,setLoading]=useState(false);const[error,setError]=useState("");
  async function load(){if(!auth?.token)return;setLoading(true);setError("");try{const[t,r,n]=await Promise.all([trips(auth.token),refunds(auth.token),notifications(auth.token)]);setRows(t);setRefundRows(r);setNotificationRows(n)}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[auth?.token]);
  if(!auth)return <Login onDone={setAuth}/>;
  function signOut(){localStorage.removeItem("seago_admin_auth");setAuth(null);setRows([]);setRefundRows([]);setNotificationRows([]);}
  return <div className="app"><header><div><b>Aqaba SeaGo</b><span>Admin Dashboard</span></div><div className="admin-head-actions"><button onClick={load}><RefreshCw size={16}/> Refresh</button><button onClick={signOut}><LogOut size={16}/> Sign out</button></div></header><main>
    <div className="admin-tabs"><button className={tab==="commissions"?"active":""} onClick={()=>setTab("commissions")}>Commissions</button><button className={tab==="refunds"?"active":""} onClick={()=>setTab("refunds")}>Cancellations & refunds</button><button className={tab==="notifications"?"active":""} onClick={()=>setTab("notifications")}>Email notifications</button></div>
    {error&&<div className="error">{error}</div>}
    {loading?<p>Loading...</p>:tab==="commissions"?<>
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
