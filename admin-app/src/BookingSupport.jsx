import React,{useEffect,useRef,useState}from"react";
import{AlertTriangle,RefreshCw,Search,TicketCheck}from"lucide-react";
import{adminBookingDetail,searchAdminBookings}from"./bookingSupportApi.js";
import{createLatestRequestManager,isAbortError}from"./requestLifecycle.js";
import"./booking-support.css";

const dateTime=value=>{if(!value)return"—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleString([],{dateStyle:"medium",timeStyle:"short"})};
const money=(value,currency="JOD")=>`${Number(value||0).toFixed(2)} ${currency||"JOD"}`;
const text=value=>value===null||value===undefined||value===""?"—":String(value);
const label=value=>String(value||"unknown").replaceAll("_"," ");

function Field({name,children}){return <div className="booking-support__field"><span>{name}</span><b>{children??"—"}</b></div>}
function State({value}){return <em className={`booking-support__state booking-support__state--${String(value||"unknown").replaceAll("_","-")}`}>{label(value)}</em>}
function Section({title,children,className=""}){return <section className={`booking-support__card ${className}`}><h3>{title}</h3>{children}</section>}

export default function BookingSupport({token}){
  const[query,setQuery]=useState("");
  const[submitted,setSubmitted]=useState("");
  const[results,setResults]=useState(null);
  const[searchLoading,setSearchLoading]=useState(false);
  const[searchError,setSearchError]=useState("");
  const[selectedId,setSelectedId]=useState("");
  const[detail,setDetail]=useState(null);
  const[detailLoading,setDetailLoading]=useState(false);
  const[detailError,setDetailError]=useState("");
  const searchManager=useRef(null);
  const detailManager=useRef(null);
  if(!searchManager.current)searchManager.current=createLatestRequestManager();
  if(!detailManager.current)detailManager.current=createLatestRequestManager();

  useEffect(()=>()=>{searchManager.current.cancel();detailManager.current.cancel()},[]);
  useEffect(()=>{searchManager.current.cancel();detailManager.current.cancel();setResults(null);setSelectedId("");setDetail(null);setSearchError("");setDetailError("")},[token]);
  useEffect(()=>{
    if(!token)return;
    const target=sessionStorage.getItem("seago_booking_support_target");
    if(!target)return;
    sessionStorage.removeItem("seago_booking_support_target");
    loadDetail(target);
  },[token]);

  async function runSearch(event){
    event?.preventDefault();
    const next=query.trim();
    if(!next){
      searchManager.current.cancel();
      detailManager.current.cancel();
      setSubmitted("");setResults(null);setSelectedId("");setDetail(null);setSearchError("");setDetailError("");
      return;
    }
    const request=searchManager.current.start();
    detailManager.current.cancel();
    setSubmitted(next);setSearchLoading(true);setSearchError("");setSelectedId("");setDetail(null);setDetailError("");
    try{
      const value=await searchAdminBookings(token,next,{signal:request.signal,limit:20});
      if(searchManager.current.isCurrent(request.id))setResults(value);
    }catch(error){
      if(searchManager.current.isCurrent(request.id)&&!isAbortError(error))setSearchError(error.message||"Could not search bookings");
    }finally{
      if(searchManager.current.isCurrent(request.id))setSearchLoading(false);
      searchManager.current.finish(request.id);
    }
  }

  async function loadDetail(bookingId,{preserve=false}={}){
    const request=detailManager.current.start();
    setSelectedId(String(bookingId));setDetailLoading(true);setDetailError("");
    if(!preserve)setDetail(null);
    try{
      const value=await adminBookingDetail(token,bookingId,{signal:request.signal});
      if(detailManager.current.isCurrent(request.id))setDetail(value);
    }catch(error){
      if(detailManager.current.isCurrent(request.id)&&!isAbortError(error))setDetailError(error.message||"Could not load booking detail");
    }finally{
      if(detailManager.current.isCurrent(request.id))setDetailLoading(false);
      detailManager.current.finish(request.id);
    }
  }

  const items=results?.items||[];
  const booking=detail?.booking;
  const payment=detail?.payment;
  const ticket=detail?.ticket;
  const cancellation=detail?.cancellation;

  return <div className="booking-support">
    <div className="booking-support__title">
      <div><small>BOOKING SUPPORT</small><h1>Booking lookup</h1><p>Read-only support view across booking, customer, provider, departure, payment, ticket, and check-in.</p></div>
      <span>Read only</span>
    </div>

    <form className="booking-support__search" onSubmit={runSearch}>
      <label htmlFor="booking-support-query">Booking reference, customer email, or phone</label>
      <div><Search size={18}/><input id="booking-support-query" value={query} onChange={event=>setQuery(event.target.value)} maxLength={120} placeholder="SG-1234ABCD · customer@example.com · +9627…" autoComplete="off"/><button type="submit" disabled={searchLoading}>{searchLoading?<><RefreshCw className="spin" size={16}/> Searching</>:"Search"}</button></div>
      <small>Exact booking reference, normalized email/phone, or exact gateway payment reference. No fuzzy search.</small>
    </form>

    {searchError?<div className="booking-support__error" role="alert">{searchError}</div>:null}

    <section className="booking-support__results" aria-live="polite">
      <div className="booking-support__section-head"><h2>Search Results</h2>{results?<span>{items.length}{results.truncated?"+":""} result{items.length===1?"":"s"}</span>:null}</div>
      {!submitted&&!searchLoading?<div className="booking-support__empty">Search by booking reference, email, or phone.</div>:null}
      {submitted&&!searchLoading&&results&&items.length===0?<div className="booking-support__empty">No bookings found.</div>:null}
      {items.length?<div className="booking-support__table-wrap"><table><thead><tr><th>Booking Ref</th><th>Customer</th><th>Provider</th><th>Trip</th><th>Departure</th><th>Booking</th><th>Payment</th><th>Total</th></tr></thead><tbody>{items.map(item=><tr key={item.bookingId} className={selectedId===String(item.bookingId)?"selected":""} onClick={()=>loadDetail(item.bookingId)}><td><button type="button" onClick={event=>{event.stopPropagation();loadDetail(item.bookingId)}}>{item.bookingReference}</button></td><td>{item.customerName}</td><td>{item.providerName}</td><td>{item.tripTitle}</td><td>{dateTime(item.departureAt)}</td><td><State value={item.bookingStatus}/></td><td>{item.paymentStatus?<State value={item.paymentStatus}/>:"—"}</td><td>{money(item.total,item.currency)}</td></tr>)}</tbody></table>{results?.truncated?<p className="booking-support__hint">Results are limited. Use a more specific exact value.</p>:null}</div>:null}
    </section>

    {selectedId?<section className="booking-support__detail-shell">
      <div className="booking-support__section-head"><div><small>BOOKING SUPPORT DETAIL</small><h2>{booking?.reference||"Loading booking…"}</h2></div><button type="button" className="secondary" onClick={()=>loadDetail(selectedId,{preserve:true})} disabled={detailLoading}><RefreshCw className={detailLoading?"spin":""} size={15}/> Refresh</button></div>
      {detailError?<div className="booking-support__error" role="alert">{detailError}{detail?<span> Last known detail remains visible.</span>:null}</div>:null}
      {detailLoading&&!detail?<div className="booking-support__loading"><RefreshCw className="spin" size={18}/> Loading booking detail…</div>:null}
      {detailLoading&&detail?<p className="booking-support__hint"><RefreshCw className="spin" size={13}/> Refreshing detail…</p>:null}

      {detail?<>
        {(detail.warnings||[]).length?<div className="booking-support__warnings">{detail.warnings.map(warning=><div key={warning.code}><AlertTriangle size={17}/><div><b>{warning.message}</b><small>{warning.code}</small></div></div>)}</div>:null}
        <div className="booking-support__grid">
          <Section title="Booking"><Field name="Reference">{booking.reference}</Field><Field name="Created">{dateTime(booking.createdAt)}</Field><Field name="Status"><State value={booking.status}/></Field><Field name="Guests">{`${booking.seats} seats · ${booking.adults} adults · ${booking.children} children`}</Field><Field name="Meal plan">{label(booking.mealPlan)}</Field><Field name="Total">{money(booking.pricingSnapshot?.grossAmount,booking.pricingSnapshot?.currency)}</Field><Field name="SeaGo commission snapshot">{booking.pricingSnapshot?.commissionAmount==null?"—":money(booking.pricingSnapshot.commissionAmount,booking.pricingSnapshot.currency)}</Field><Field name="Provider net snapshot">{booking.pricingSnapshot?.providerNetAmount==null?"—":money(booking.pricingSnapshot.providerNetAmount,booking.pricingSnapshot.currency)}</Field></Section>
          <Section title="Customer"><Field name="Name">{detail.customer?.name}</Field><Field name="Email">{text(detail.customer?.email)}</Field><Field name="Phone">{text(detail.customer?.phone)}</Field></Section>
          <Section title="Provider"><Field name="Business">{detail.provider?.businessName}</Field><Field name="Status"><State value={detail.provider?.status}/></Field></Section>
          <Section title="Trip"><Field name="Title">{detail.trip?.title}</Field><Field name="Vessel">{text(detail.trip?.vesselName)}</Field><Field name="Provider active">{detail.trip?.providerActive?"Yes":"No"}</Field><Field name="Platform"><State value={detail.trip?.platformStatus}/></Field></Section>
          <Section title="Departure"><Field name="Date / time">{dateTime(detail.departure?.startsAt)}</Field><Field name="Status"><State value={detail.departure?.status}/></Field><Field name="Capacity">{text(detail.departure?.capacity)}</Field><Field name="Reserved">{text(detail.departure?.reservedSeats)}</Field><Field name="Sales closed">{detail.departure?.salesClosed===null?"—":detail.departure?.salesClosed?"Yes":"No"}</Field><Field name="Departure point">{[detail.departure?.point?.name,detail.departure?.point?.address].filter(Boolean).join(" · ")||"—"}</Field></Section>
          <Section title="Payment" className={payment?.needsReview?"booking-support__card--attention":""}>{payment?<><Field name="Gateway">{payment.gateway}</Field><Field name="Status"><State value={payment.status}/></Field><Field name="Amount">{money(payment.amount,payment.currency)}</Field><Field name="External payment ID">{text(payment.externalPaymentId)}</Field><Field name="Created">{dateTime(payment.createdAt)}</Field><Field name="Updated">{dateTime(payment.updatedAt)}</Field><Field name="Refunded">{money(payment.refundedAmount,payment.currency)}</Field><Field name="Refund status">{label(payment.refundStatus)}</Field><Field name="Refund reference">{text(payment.refundReference)}</Field>{payment.diagnosticSummary?<p className="booking-support__diagnostic">{payment.diagnosticSummary}</p>:null}</>:<div className="booking-support__empty booking-support__empty--compact">Payment record not found.</div>}</Section>
          <Section title="Ticket & check-in"><Field name="Ticket">{ticket?.available?<State value={ticket.status}/>:"Ticket not available."}</Field><Field name="Ticket source">{ticket?.source==="booking_derived"?"Derived from booking (no stored ticket record)":"—"}</Field><Field name="Check-in">{detail.checkIn?.checkedIn?"Checked in":"Not checked in"}</Field><Field name="Checked in at">{dateTime(detail.checkIn?.checkedInAt)}</Field><Field name="Checked in by">{detail.checkIn?.checkedInBy?.name?`${detail.checkIn.checkedInBy.name}${detail.checkIn.checkedInBy.role?` · ${detail.checkIn.checkedInBy.role}`:""}`:"—"}</Field><p className="booking-support__diagnostic"><TicketCheck size={15}/> Signed ticket tokens, QR payloads, and signatures are intentionally not exposed.</p></Section>
          <Section title="Cancellation / refund">{cancellation?<><Field name="Source">{text(cancellation.source)}</Field><Field name="Reason">{text(cancellation.reason)}</Field><Field name="Cancelled at">{dateTime(cancellation.cancelledAt)}</Field><Field name="Refund percentage">{cancellation.refundPercentage==null?"—":`${cancellation.refundPercentage}%`}</Field><Field name="Refund amount">{money(cancellation.refundAmount,booking.pricingSnapshot?.currency)}</Field><Field name="Refund state"><State value={cancellation.refundStatus}/></Field><Field name="Retained amount">{money(cancellation.retainedAmount,booking.pricingSnapshot?.currency)}</Field></>:<div className="booking-support__empty booking-support__empty--compact">No cancellation recorded.</div>}</Section>
        </div>
      </>:null}
    </section>:null}
  </div>;
}
