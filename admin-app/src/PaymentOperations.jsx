import React,{useEffect,useRef,useState}from"react";
import{AlertTriangle,ChevronLeft,ChevronRight,CircleDollarSign,RefreshCw,Search,X}from"lucide-react";
import{adminPaymentDetail,adminPayments}from"./paymentOperationsApi.js";
import{createLatestRequestManager,isAbortError}from"./requestLifecycle.js";
import"./payment-operations.css";

const EMPTY_FILTERS={status:"all",provider:"",from:"",to:"",booking:"any",needsReview:"any",refund:"any",q:"",page:1,limit:25};
const dateTime=value=>{if(!value)return"—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleString([],{dateStyle:"medium",timeStyle:"short"})};
const money=(value,currency="JOD")=>`${Number(value||0).toFixed(2)} ${currency||"JOD"}`;
const label=value=>String(value||"unknown").replaceAll("_"," ");
const text=value=>value===undefined||value===null||value===""?"—":String(value);

function State({value}){return <em className={`payment-ops__state payment-ops__state--${String(value||"unknown").replaceAll("_","-")}`}>{label(value)}</em>}
function Field({name,children}){return <div className="payment-ops__field"><span>{name}</span><b>{children??"—"}</b></div>}
function Card({title,children,className=""}){return <section className={`payment-ops__card ${className}`}><h3>{title}</h3>{children}</section>}

export default function PaymentOperations({token,intent=null,onClose,onNavigate}){
  const[filters,setFilters]=useState(EMPTY_FILTERS);
  const[searchDraft,setSearchDraft]=useState("");
  const[data,setData]=useState(null);
  const[listLoading,setListLoading]=useState(false);
  const[listError,setListError]=useState("");
  const[listRetry,setListRetry]=useState(0);
  const[selectedId,setSelectedId]=useState("");
  const[detail,setDetail]=useState(null);
  const[detailLoading,setDetailLoading]=useState(false);
  const[detailError,setDetailError]=useState("");
  const listManager=useRef(null);
  const detailManager=useRef(null);
  if(!listManager.current)listManager.current=createLatestRequestManager();
  if(!detailManager.current)detailManager.current=createLatestRequestManager();

  useEffect(()=>()=>{listManager.current.cancel();detailManager.current.cancel()},[]);
  useEffect(()=>{listManager.current.cancel();detailManager.current.cancel();setData(null);setDetail(null);setSelectedId("");setListError("");setDetailError("")},[token]);

  useEffect(()=>{
    if(!token)return;
    const request=listManager.current.start();
    setListLoading(true);setListError("");
    adminPayments(token,filters,{signal:request.signal}).then(value=>{
      if(listManager.current.isCurrent(request.id))setData(value);
    }).catch(error=>{
      if(listManager.current.isCurrent(request.id)&&!isAbortError(error))setListError(error.message||"Could not load payments");
    }).finally(()=>{
      if(listManager.current.isCurrent(request.id))setListLoading(false);
      listManager.current.finish(request.id);
    });
    return()=>listManager.current.cancel();
  },[token,filters.status,filters.provider,filters.from,filters.to,filters.booking,filters.needsReview,filters.refund,filters.q,filters.page,filters.limit,listRetry]);

  useEffect(()=>{
    if(!intent?.nonce)return;
    if(intent.paymentId){loadDetail(intent.paymentId);return;}
    if(intent.needsReview){
      setFilters(current=>({...current,status:"all",needsReview:"true",page:1}));
    }
  },[intent?.nonce]);

  async function loadDetail(paymentId,{preserve=false}={}){
    if(!paymentId)return;
    const request=detailManager.current.start();
    setSelectedId(String(paymentId));setDetailLoading(true);setDetailError("");
    if(!preserve)setDetail(null);
    try{
      const value=await adminPaymentDetail(token,paymentId,{signal:request.signal});
      if(detailManager.current.isCurrent(request.id))setDetail(value);
    }catch(error){
      if(detailManager.current.isCurrent(request.id)&&!isAbortError(error))setDetailError(error.message||"Could not load payment detail");
    }finally{
      if(detailManager.current.isCurrent(request.id))setDetailLoading(false);
      detailManager.current.finish(request.id);
    }
  }

  function updateFilter(name,value){setFilters(current=>({...current,[name]:value,page:1}))}
  function submitSearch(event){event.preventDefault();setFilters(current=>({...current,q:searchDraft.trim(),page:1}))}
  function clearFilters(){setSearchDraft("");setFilters(EMPTY_FILTERS)}
  function openBooking(bookingId){
    if(!bookingId)return;
    sessionStorage.setItem("seago_booking_support_target",String(bookingId));
    onNavigate?.("booking-support");
  }

  const items=data?.items||[];
  const pagination=data?.pagination||{page:1,total:0,totalPages:1,hasPrevious:false,hasNext:false};
  const payment=detail?.payment;
  const booking=detail?.booking;
  const review=detail?.review;
  const refund=detail?.refund;
  const events=detail?.events||[];

  return <section className="payment-ops" id="payment-operations" aria-labelledby="payment-operations-title">
    <div className="payment-ops__title">
      <div><small>PAYMENT OPERATIONS</small><h2 id="payment-operations-title">Payment visibility</h2><p>Read-only payment diagnostics. No force-paid, refund, retry, replay, or manual state controls.</p></div>
      <div className="payment-ops__title-actions"><span>Read only</span><button type="button" className="secondary" onClick={()=>setListRetry(value=>value+1)} disabled={listLoading}><RefreshCw className={listLoading?"spin":""} size={15}/> Refresh</button>{onClose?<button type="button" className="secondary" onClick={onClose} aria-label="Close payment operations"><X size={16}/></button>:null}</div>
    </div>

    <div className="payment-ops__filters">
      <label><span>Status</span><select value={filters.status} onChange={event=>updateFilter("status",event.target.value)}><option value="all">All statuses</option>{(data?.filters?.statuses||[]).map(status=><option key={status} value={status}>{label(status)}</option>)}</select></label>
      <label><span>Gateway</span><select value={filters.provider} onChange={event=>updateFilter("provider",event.target.value)}><option value="">All gateways</option>{(data?.filters?.gateways||[]).map(gateway=><option key={gateway} value={gateway}>{gateway}</option>)}</select></label>
      <label><span>Booking relation</span><select value={filters.booking} onChange={event=>updateFilter("booking",event.target.value)}><option value="any">Any</option><option value="linked">Has booking</option><option value="missing">Missing booking</option></select></label>
      <label><span>Review</span><select value={filters.needsReview} onChange={event=>updateFilter("needsReview",event.target.value)}><option value="any">Any</option><option value="true">Needs review</option><option value="false">Not needs review</option></select></label>
      <label><span>Refund</span><select value={filters.refund} onChange={event=>updateFilter("refund",event.target.value)}><option value="any">Any</option><option value="any_refund">Any refund</option><option value="partially_refunded">Partially refunded</option><option value="refunded">Refunded</option></select></label>
      <label><span>From</span><input type="date" value={filters.from} onChange={event=>updateFilter("from",event.target.value)}/></label>
      <label><span>To</span><input type="date" value={filters.to} onChange={event=>updateFilter("to",event.target.value)}/></label>
      <form className="payment-ops__search" onSubmit={submitSearch}><span>Exact search</span><div><Search size={16}/><input value={searchDraft} onChange={event=>setSearchDraft(event.target.value)} maxLength={120} placeholder="Payment ID · external ID · SG-…" autoComplete="off"/><button type="submit">Search</button></div></form>
      <button type="button" className="secondary payment-ops__clear" onClick={clearFilters}>Clear filters</button>
    </div>

    {listError?<div className="payment-ops__error" role="alert"><AlertTriangle size={17}/><span>{listError}.{data?" Last known payment list remains visible.":""}</span><button type="button" className="secondary" onClick={()=>setListRetry(value=>value+1)}>Retry</button></div>:null}
    {listLoading&&data?<p className="payment-ops__hint"><RefreshCw className="spin" size={13}/> Refreshing payments…</p>:null}
    {listLoading&&!data?<div className="payment-ops__loading"><RefreshCw className="spin" size={18}/> Loading payments…</div>:null}

    {data?<>
      <div className="payment-ops__table-head"><b>Recent payments</b><span>{pagination.total} total · newest first</span></div>
      {items.length?<div className="payment-ops__table-wrap"><table><thead><tr><th>Time</th><th>Status</th><th>Amount</th><th>Gateway</th><th>Booking</th><th>Provider</th><th>External ID</th><th>Review</th></tr></thead><tbody>{items.map(item=><tr key={item.id} className={selectedId===String(item.id)?"selected":""} onClick={()=>loadDetail(item.id)}><td>{dateTime(item.createdAt)}</td><td><State value={item.status}/></td><td>{money(item.amount,item.currency)}</td><td>{text(item.gateway)}</td><td>{item.booking?.reference||"—"}</td><td>{item.businessProvider?.businessName||"—"}</td><td className="payment-ops__mono">{text(item.externalPaymentId)}</td><td>{item.needsReview?<strong className="payment-ops__review">Needs review</strong>:(item.warnings||[]).length?<span className="payment-ops__warning-count">{item.warnings.length} warning{item.warnings.length===1?"":"s"}</span>:"—"}</td></tr>)}</tbody></table></div>:<div className="payment-ops__empty">No payments found.</div>}
      <div className="payment-ops__pagination"><button type="button" className="secondary" disabled={!pagination.hasPrevious||listLoading} onClick={()=>setFilters(current=>({...current,page:current.page-1}))}><ChevronLeft size={15}/> Previous</button><span>Page {pagination.page} of {pagination.totalPages}</span><button type="button" className="secondary" disabled={!pagination.hasNext||listLoading} onClick={()=>setFilters(current=>({...current,page:current.page+1}))}>Next <ChevronRight size={15}/></button></div>
    </>:null}

    {selectedId?<div className="payment-ops__detail">
      <div className="payment-ops__detail-head"><div><small>PAYMENT DETAIL</small><h3>{payment?.externalPaymentId||payment?.id||"Loading payment…"}</h3></div><button type="button" className="secondary" onClick={()=>loadDetail(selectedId,{preserve:true})} disabled={detailLoading}><RefreshCw className={detailLoading?"spin":""} size={14}/> Refresh detail</button></div>
      {detailError?<div className="payment-ops__error" role="alert"><AlertTriangle size={17}/><span>{detailError}.{detail?" Last known detail remains visible.":""}</span></div>:null}
      {detailLoading&&!detail?<div className="payment-ops__loading"><RefreshCw className="spin" size={18}/> Loading payment detail…</div>:null}
      {detailLoading&&detail?<p className="payment-ops__hint"><RefreshCw className="spin" size={13}/> Refreshing detail…</p>:null}

      {detail?<>
        {(review?.warnings||[]).length?<div className="payment-ops__warnings">{review.warnings.map(warning=><div key={warning.code}><AlertTriangle size={17}/><div><b>{warning.message}</b><small>{warning.code}</small></div></div>)}</div>:null}
        <div className="payment-ops__grid">
          <Card title="Payment"><Field name="Internal ID"><span className="payment-ops__mono">{payment.id}</span></Field><Field name="Gateway">{payment.gateway}</Field><Field name="External payment ID"><span className="payment-ops__mono">{text(payment.externalPaymentId)}</span></Field><Field name="Status"><State value={payment.status}/></Field><Field name="Amount">{money(payment.amount,payment.currency)}</Field><Field name="Refunded amount">{money(payment.refundedAmount,payment.currency)}</Field><Field name="Created">{dateTime(payment.createdAt)}</Field><Field name="Updated">{dateTime(payment.updatedAt)}</Field><Field name="Last event">{dateTime(payment.lastEventAt)}</Field></Card>
          <Card title="Booking relation">{booking?<><Field name="Booking reference">{booking.reference}</Field><Field name="Booking status"><State value={booking.status}/></Field><Field name="Customer">{booking.customer?.name||"Customer"}</Field><Field name="Email">{text(booking.customer?.email)}</Field><Field name="Phone">{text(booking.customer?.phone)}</Field><Field name="Provider">{booking.businessProvider?.businessName||"—"}</Field><Field name="Trip">{booking.trip?.title||"—"}</Field><Field name="Departure">{dateTime(booking.departure?.startsAt)}</Field><Field name="Snapshot total">{money(booking.pricingSnapshot?.grossAmount,booking.pricingSnapshot?.currency)}</Field><button type="button" className="payment-ops__booking-link" onClick={()=>openBooking(booking.id)}>Open Booking Support</button></>:<div className="payment-ops__empty payment-ops__empty--compact">Payment is not linked to a booking.</div>}</Card>
          <Card title="Review" className={review?.needsReview?"payment-ops__card--attention":""}><Field name="Needs review">{review?.needsReview?"Yes":"No"}</Field>{review?.summary?<p className="payment-ops__diagnostic">{review.summary}</p>:<p className="payment-ops__diagnostic">No backend review marker is present.</p>}</Card>
          <Card title="Refund"><Field name="State"><State value={refund?.state}/></Field><Field name="Refunded amount">{money(refund?.amount,payment.currency)}</Field><Field name="Refund reference">{text(refund?.reference)}</Field><Field name="Refunded at">{dateTime(refund?.refundedAt)}</Field><p className="payment-ops__diagnostic">Visibility only. Refund controls are not available in this task.</p></Card>
          <Card title="Checkout hold"><Field name="Relation">{detail.checkoutHold?"Linked":"Missing"}</Field>{detail.checkoutHold?<><Field name="Status"><State value={detail.checkoutHold.status}/></Field><Field name="Expires">{dateTime(detail.checkoutHold.expiresAt)}</Field></>:<p className="payment-ops__diagnostic">No readable CheckoutHold relation.</p>}</Card>
        </div>
        <Card title="Payment event timeline"><p className="payment-ops__diagnostic">Safe metadata only. Raw webhook payloads, signatures, tokens, and authorization data are never shown.</p>{events.length?<div className="payment-ops__events">{events.map((event,index)=><div key={`${event.eventId}:${index}`}><CircleDollarSign size={16}/><div><b>{label(event.status||"event")}</b><span>{event.eventId}</span><small>{dateTime(event.processedAt||event.receivedAt)}{event.amount!==null?` · ${money(event.amount,event.currency||payment.currency)}`:""}</small></div></div>)}</div>:<div className="payment-ops__empty payment-ops__empty--compact">No payment events available.</div>}</Card>
      </>:null}
    </div>:null}
  </section>;
}
