import React, { useEffect, useMemo, useState } from "react";
import {
  Anchor, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Heart, Home,
  LoaderCircle, MapPin, Search, ShipWheel, Sparkles, Star, Ticket, UserRound, UsersRound
} from "lucide-react";
import BrandLogo from "./BrandLogo.jsx";
import { QRCodeSVG } from "qrcode.react";
import { categories, trips as fallbackTrips } from "./data.js";
import {
  createPaymentCheckout, getQuote, hasApi, listBookings, listDepartures, listTrips,
  loginCustomer, registerCustomer, getCancellationPolicy, cancelBooking
} from "./api.js";

const CATEGORY_LABELS = {
  group_boat: "Boat Trip",
  private_boat: "Private Boat",
  yacht: "Yacht",
  glass_bottom: "Glass Bottom",
  snorkeling: "Snorkeling",
  diving: "Diving",
  fishing: "Fishing",
  sunset: "Sunset",
  private_event: "Private Event",
  water_sports: "Water Sports",
  semi_submarine: "Semi Submarine"
};

function normalizeTrip(raw, index = 0) {
  if (!raw?._id) return raw;
  const category = CATEGORY_LABELS[raw.category] || "Sea Experience";
  const accent = raw.category === "yacht" || raw.category === "sunset"
    ? "sunset"
    : raw.category === "snorkeling" || raw.category === "diving"
      ? "reef"
      : "glass";

  return {
    id: raw._id,
    apiId: raw._id,
    title: raw.titleEn || raw.titleAr || "Aqaba Sea Experience",
    subtitle: `${raw.providerId?.businessName || "Aqaba SeaGo partner"} · ${category}`,
    duration: raw.durationMinutes ? `${raw.durationMinutes} min` : "Flexible",
    price: Number(raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    childPrice: Number(raw.pricing?.childPrice ?? raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    buffetEnabled: Boolean(raw.pricing?.buffetEnabled),
    buffetAdultPrice: Number(raw.pricing?.buffetAdultPrice ?? raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    buffetChildPrice: Number(raw.pricing?.buffetChildPrice ?? raw.pricing?.childPrice ?? raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    buffetDescription: String(raw.pricing?.buffetDescription || ""),
    images: Array.isArray(raw.images) ? raw.images.map(x=>typeof x==="string"?x:x?.url).filter(Boolean) : [],
    rating: null,
    reviews: null,
    category,
    accent,
    description: `Discover Aqaba's Red Sea with an approved SeaGo partner. This ${category.toLowerCase()} experience is managed through the Aqaba SeaGo booking platform.`,
    departureLocation: raw.departureLocation || null,
    source: "api",
    raw,
    index
  };
}

function HeroScene() {
  return (
    <div className="hero-scene" aria-hidden="true">
      <svg viewBox="0 0 900 520" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dff4ff" />
            <stop offset="1" stopColor="#f8fdff" />
          </linearGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0288D1" />
            <stop offset="1" stopColor="#00BCD4" />
          </linearGradient>
        </defs>
        <rect width="900" height="520" fill="url(#sky)" />
        <path d="M0 240 L110 164 L188 223 L292 132 L408 231 L500 150 L620 238 L718 159 L900 245 L900 330 L0 330Z" fill="#b27569" opacity=".9"/>
        <path d="M0 270 L105 207 L190 251 L299 176 L415 258 L524 194 L642 264 L760 211 L900 275 L900 345 L0 345Z" fill="#c99681" opacity=".8"/>
        <path d="M0 300 C170 278, 280 316, 445 295 C610 274, 720 314, 900 294 L900 520 L0 520Z" fill="url(#sea)" />
        <path d="M0 350 C180 322, 340 374, 520 343 C660 320, 760 360, 900 338" fill="none" stroke="white" strokeWidth="8" opacity=".4"/>
        <g transform="translate(485 285)">
          <path d="M0 55 L210 55 L180 98 L35 98Z" fill="#f9fbff"/>
          <path d="M42 15 L166 15 L188 54 L24 54Z" fill="#e7f5fb"/>
          <path d="M72 0 L150 0 L169 15 L56 15Z" fill="#0B3D91"/>
          <path d="M88 4 L95 48" stroke="#0B3D91" strokeWidth="6"/>
          <path d="M106 4 L116 48" stroke="#0B3D91" strokeWidth="5"/>
          <rect x="54" y="23" width="28" height="16" rx="4" fill="#5BA4C9"/>
          <rect x="92" y="23" width="28" height="16" rx="4" fill="#5BA4C9"/>
          <rect x="130" y="23" width="28" height="16" rx="4" fill="#5BA4C9"/>
          <path d="M28 67 C76 82, 138 82, 195 67" fill="none" stroke="#0288D1" strokeWidth="7"/>
        </g>
      </svg>
    </div>
  );
}

function ApiNotice({ usingFallback }) {
  if (!usingFallback) return null;
  return (
    <div className="api-notice">
      Preview mode · live API will replace sample trips automatically when deployed.
    </div>
  );
}

function HomeScreen({ tripList, onSelectTrip, favourites, toggleFavourite, usingFallback, onSearch }) {
  const [tripType,setTripType]=useState("All Trips");
  const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [guests,setGuests]=useState(2);
  const [searching,setSearching]=useState(false);

  async function submitSearch(){
    setSearching(true);
    try { await onSearch({tripType,date,guests}); }
    finally { setSearching(false); }
  }

  return (
    <div className="screen screen--home">
      <section className="hero">
        <HeroScene />
        <div className="hero__top">
          <BrandLogo />
          <button className="icon-button" aria-label="Menu"><span className="hamburger">☰</span></button>
        </div>
        <div className="hero__copy">
          <p className="eyebrow">EXPLORE · SWIM · DISCOVER</p>
          <h1>Boat Trips<br/>in Aqaba</h1>
          <p>Discover the Red Sea your way.</p>
        </div>
        <div className="search-card">
          <label className="search-row search-row--control">
            <span className="search-row__icon"><Anchor size={18}/></span>
            <span><small>Trip Type</small>
              <select value={tripType} onChange={e=>setTripType(e.target.value)}>
                {categories.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </span>
            <ChevronRight size={18}/>
          </label>
          <label className="search-row search-row--control">
            <span className="search-row__icon"><CalendarDays size={18}/></span>
            <span><small>Date</small>
              <input type="date" value={date} min={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)}/>
            </span>
            <ChevronRight size={18}/>
          </label>
          <div className="search-row search-row--control">
            <span className="search-row__icon"><UsersRound size={18}/></span>
            <span><small>Guests</small><strong>{guests} {guests===1?"Guest":"Guests"}</strong></span>
            <div className="guest-stepper">
              <button type="button" onClick={()=>setGuests(Math.max(1,guests-1))}>−</button>
              <button type="button" onClick={()=>setGuests(Math.min(20,guests+1))}>+</button>
            </div>
          </div>
          <button className="primary-button" onClick={submitSearch} disabled={searching}>
            {searching?<LoaderCircle className="spin" size={18}/>:<Search size={18}/>}
            {searching?"Searching...":"Search Trips"} <ChevronRight size={18}/>
          </button>
        </div>
      </section>

      <ApiNotice usingFallback={usingFallback} />

      <section className="content-section">
        <div className="section-heading"><div><span>CURATED FOR YOU</span><h2>Popular Sea Experiences</h2></div><button>See all</button></div>
        <div className="trip-strip">
          {tripList.slice(0,3).map(trip => (
            <TripCard key={trip.id} trip={trip} onSelectTrip={onSelectTrip} favourite={favourites.includes(trip.id)} toggleFavourite={toggleFavourite}/>
          ))}
        </div>
      </section>
    </div>
  );
}

function TripCard({ trip, onSelectTrip, favourite, toggleFavourite }) {
  return (
    <article className="trip-card" onClick={() => onSelectTrip(trip)}>
      <div className={"trip-card__visual trip-card__visual--"+trip.accent} style={trip.images?.[0]?{backgroundImage:`linear-gradient(rgba(4,34,55,.08),rgba(4,34,55,.18)),url("${trip.images[0]}")`,backgroundSize:"cover",backgroundPosition:"center"}:undefined}>
        <span className="trip-card__badge">{trip.category}</span>
        <button className={"heart-button "+(favourite?"is-active":"")} onClick={(e)=>{e.stopPropagation();toggleFavourite(trip.id);}}><Heart size={18} fill={favourite?"currentColor":"none"}/></button>
        {!trip.images?.[0]&&<ShipWheel size={46} strokeWidth={1.5}/>}
      </div>
      <div className="trip-card__body">
        {trip.rating ? <div className="rating"><Star size={14} fill="currentColor"/> {trip.rating} <span>({trip.reviews})</span></div> : <div className="rating rating--partner"><CheckCircle2 size={14}/> SeaGo partner</div>}
        <h3>{trip.title}</h3>
        <p>{trip.subtitle}</p>
        <div className="trip-card__meta"><span>{trip.duration}</span><strong>From {trip.price} JOD</strong></div>
      </div>
    </article>
  );
}

function TripsScreen({ tripList, onSelectTrip, favourites, toggleFavourite, loading, searchSummary }) {
  const [filter,setFilter]=useState("All Trips");
  const shown=useMemo(()=>{
    if(filter==="All Trips") return tripList;
    const token=filter.replace(/s$/,"").toLowerCase();
    return tripList.filter(t =>
      t.category.toLowerCase().includes(token) ||
      t.title.toLowerCase().includes(token)
    );
  },[filter,tripList]);

  return (
    <div className="screen standard-screen">
      <header className="standard-header"><BrandLogo compact/><div><span>{searchSummary||"DISCOVER AQABA"}</span><h1>Sea Experiences</h1></div></header>
      <div className="category-row">{categories.map(c=><button className={filter===c?"active":""} onClick={()=>setFilter(c)} key={c}>{c}</button>)}</div>
      {loading ? <LoadingState label="Loading sea experiences"/> :
        shown.length
          ? <div className="trip-grid">{shown.map(t=><TripCard key={t.id} trip={t} onSelectTrip={onSelectTrip} favourite={favourites.includes(t.id)} toggleFavourite={toggleFavourite}/>)}</div>
          : <div className="empty-state"><Search size={44}/><h2>No matching trips</h2><p>There are no trips with enough available seats for the selected date and filters. Try another date, trip type, or guest count.</p></div>}
    </div>
  );
}

function DetailScreen({ trip, onBack, favourite, toggleFavourite, onBook }) {
  if(!trip) return null;
  return (
    <div className="screen detail-screen">
      <div className={"detail-hero detail-hero--"+trip.accent} style={trip.images?.[0]?{backgroundImage:`linear-gradient(rgba(3,31,51,.15),rgba(3,31,51,.28)),url("${trip.images[0]}")`,backgroundSize:"cover",backgroundPosition:"center"}:undefined}>
        <button className="detail-back" onClick={onBack}><ChevronLeft/></button>
        <button className={"detail-heart "+(favourite?"is-active":"")} onClick={()=>toggleFavourite(trip.id)}><Heart fill={favourite?"currentColor":"none"}/></button>
        <BrandLogo compact/>
        {!trip.images?.[0]&&<ShipWheel size={88} strokeWidth={1.1}/>}
      </div>
      <div className="detail-body">
        <div className="detail-kicker">{trip.category} · Aqaba, Jordan</div>
        <h1>{trip.title}</h1>
        {trip.rating ? <div className="detail-rating"><Star size={16} fill="currentColor"/> {trip.rating} <span>{trip.reviews} reviews</span></div> : <div className="detail-rating"><CheckCircle2 size={16}/> Approved SeaGo experience</div>}
        <p className="detail-description">{trip.description}</p>{trip.images?.length>1&&<div className="trip-gallery">{trip.images.slice(1,6).map((u,i)=><img key={u+i} src={u} alt={`${trip.title} ${i+2}`}/>)}</div>}
        <div className="feature-grid">
          <div><Anchor/><span><small>Experience</small><b>{trip.category}</b></span></div>
          <div><CalendarDays/><span><small>Duration</small><b>{trip.duration}</b></span></div>
          <div><UsersRound/><span><small>Guests</small><b>Live availability</b></span></div>
          <div><MapPin/><span><small>Departure</small><b>{trip.departureLocation?.name || "Aqaba"}</b></span></div>
        </div>
        {trip.buffetEnabled&&<section className="buffet-info"><span>OPEN BUFFET OPTION</span><h2>Available with this trip</h2><p>{trip.buffetDescription||"Buffet details are provided by the operator."}</p></section>}{trip.departureLocation?.name&&<section className="departure-location"><span>DEPARTURE POINT</span><h2>{trip.departureLocation.name}</h2>{trip.departureLocation.address&&<p>{trip.departureLocation.address}</p>}{trip.departureLocation.googleMapsUrl&&<a href={trip.departureLocation.googleMapsUrl} target="_blank" rel="noreferrer">Open in Maps</a>}</section>}<section className="included"><span>WHAT'S INCLUDED</span><h2>Everything for an easy day at sea</h2><p>Experience details are managed by the approved operator and shown through Aqaba SeaGo.</p></section>
      </div>
      <div className="sticky-booking"><div><small>From</small><strong>{trip.price} JOD</strong><span>/ person</span></div><button className="primary-button" onClick={onBook}>Book now <ChevronRight size={18}/></button></div>
    </div>
  );
}

function AuthForm({ onAuthenticated }) {
  const [mode,setMode]=useState("login");
  const [form,setForm]=useState({name:"",email:"",phone:"",password:""});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const result = mode === "login"
        ? await loginCustomer({email:form.email,password:form.password})
        : await registerCustomer(form);
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-panel">
      <div className="auth-panel__head">
        <span>SEAGO ACCOUNT</span>
        <h2>{mode==="login" ? "Sign in to book" : "Create your account"}</h2>
        <p>Your account keeps bookings and favourites together.</p>
      </div>
      <form onSubmit={submit}>
        {mode==="register" && <input placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/>}
        <input type="email" placeholder="Email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required/>
        {mode==="register" && <input placeholder="Phone (optional)" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>}
        <input type="password" minLength="6" placeholder="Password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required/>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button auth-submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18}/> : null}
          {mode==="login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button className="auth-switch" onClick={()=>setMode(mode==="login"?"register":"login")}>
        {mode==="login" ? "New to SeaGo? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

function formatDeparture(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    weekday:"short", day:"numeric", month:"short", hour:"numeric", minute:"2-digit"
  }).format(date);
}

function BookingScreen({ trip, auth, onAuthenticated, onBack, initialCriteria }) {
  const [adults,setAdults]=useState(()=>Math.max(1,Number(initialCriteria?.guests||2)));
  const [children,setChildren]=useState(0);
  const [mealPlan,setMealPlan]=useState("without_buffet");
  const guests=adults+children;
  const [departures,setDepartures]=useState([]);
  const [selected,setSelected]=useState(null);
  const [quote,setQuote]=useState(null);
  const [loading,setLoading]=useState(Boolean(trip.apiId && hasApi()));
  const [error,setError]=useState("");
  const [success,setSuccess]=useState(null);
  const live = Boolean(trip.apiId && hasApi());

  useEffect(()=>{
    let ignore=false;
    if(!live) { setLoading(false); return; }
    setLoading(true);
    listDepartures(trip.apiId)
      .then(rows=>{
        if(ignore) return;
        setDepartures(rows);
        const wantedDate=initialCriteria?.date || "";
        const matching=rows.find(x=>{
          const depDate=new Date(x.startsAt).toISOString().slice(0,10);
          return Number(x.availableSeats||0)>=Number(initialCriteria?.guests||1) && (!wantedDate || depDate===wantedDate);
        });
        const first=matching || rows.find(x=>Number(x.availableSeats||0)>=Number(initialCriteria?.guests||1));
        setSelected(first || null);
      })
      .catch(err=>{ if(!ignore) setError(err.message); })
      .finally(()=>{ if(!ignore) setLoading(false); });
    return()=>{ignore=true;};
  },[trip.apiId,live,initialCriteria?.date,initialCriteria?.guests]);

  useEffect(()=>{
    let ignore=false;
    if(!live || !selected) { setQuote(null); return; }
    getQuote(selected.id,adults,children,mealPlan)
      .then(q=>{if(!ignore){setQuote(q);setError("");}})
      .catch(err=>{if(!ignore){setQuote(null);setError(err.message);}});
    return()=>{ignore=true;};
  },[selected,adults,children,mealPlan,live]);

  async function confirm() {
    setError("");
    if(!live) {
      setSuccess({demo:true, id:"DEMO-"+Date.now()});
      return;
    }
    if(!selected) return setError("No available departure selected.");
    if(guests<1) return setError("Add at least one adult or child.");
    if(!auth?.token) return setError("AUTH_REQUIRED");

    try {
      const payment=await createPaymentCheckout({departureId:selected.id,adults,children,mealPlan,token:auth.token});
      setSuccess({
        expiresAt:payment.expiresAt,
        paymentId:payment.paymentId,
        paymentProvider:payment.provider,
        checkoutUrl:payment.checkoutUrl
      });
    } catch(err) {
      setError(err.message);
    }
  }

  if(success) {
    return (
      <div className="screen standard-screen booking-success">
        <BrandLogo />
        <CheckCircle2 size={70}/>
        <span>PAYMENT REQUIRED</span>
        <h1>Complete payment to confirm</h1>
        <p>{success.demo ? "Preview flow completed." : "No booking is created until payment succeeds. Your selected seats are temporarily protected during checkout."}</p>
        {!success.demo && success.expiresAt && <div className="hold-box">Checkout expires: <b>{formatDeparture(success.expiresAt)}</b></div>}
        {!success.demo && success.checkoutUrl && <button className="primary-button" onClick={()=>{window.location.href=success.checkoutUrl;}}>Continue to payment <ChevronRight size={18}/></button>}
        <button className="secondary-button" onClick={onBack}>Back to trip</button>
      </div>
    );
  }

  if(error==="AUTH_REQUIRED") {
    return (
      <div className="screen standard-screen booking-screen">
        <div className="booking-top"><button className="plain-back" onClick={()=>setError("")}><ChevronLeft/></button><BrandLogo compact/><span/></div>
        <AuthForm onAuthenticated={data=>{onAuthenticated(data);setError("");}}/>
      </div>
    );
  }

  const total=quote?.pricing?.grossAmount ?? trip.price*guests;

  return (
    <div className="screen standard-screen booking-screen">
      <div className="booking-top"><button className="plain-back" onClick={onBack}><ChevronLeft/></button><BrandLogo compact/><span/></div>
      <div className="booking-title"><span>SECURE YOUR TRIP</span><h1>Complete booking</h1>{initialCriteria?.date&&<p className="booking-search-context">Your search: {new Date(initialCriteria.date+"T12:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})} · {guests} {guests===1?"guest":"guests"}</p>}</div>
      <div className="booking-summary"><div className={"booking-thumb booking-thumb--"+trip.accent}><ShipWheel/></div><div><small>{trip.category}</small><h3>{trip.title}</h3><p>{trip.duration} · Aqaba</p></div></div>
      {trip.departureLocation?.name&&<div className="booking-location-card"><div><MapPin size={20}/><span><small>Departure point</small><strong>{trip.departureLocation.name}</strong>{trip.departureLocation.address&&<em>{trip.departureLocation.address}</em>}</span></div>{trip.departureLocation.googleMapsUrl&&<a href={trip.departureLocation.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps <ChevronRight size={16}/></a>}</div>}

      {loading ? <LoadingState label="Checking live departures"/> : (
        <>
          <div className="departure-block">
            <span>AVAILABLE DEPARTURES</span>
            {live && departures.length ? departures.slice(0,4).map(d=>(
              <button key={d.id} className={selected?.id===d.id?"departure-option active":"departure-option"} onClick={()=>setSelected(d)} disabled={d.availableSeats<1}>
                <CalendarDays size={17}/>
                <div><b>{formatDeparture(d.startsAt)}</b><small>{d.availableSeats} seats available</small></div>
                <CheckCircle2 size={17}/>
              </button>
            )) : live ? <div className="no-departures">No future departures are available yet.</div> : <div className="preview-departure"><CalendarDays size={18}/> Preview date · live dates appear after API deployment</div>}
          </div>

          <div className="booking-form booking-form--guests">
            <label><span>Adults <small>13+</small></span><div className="stepper"><button type="button" onClick={()=>setAdults(Math.max(0,adults-1))} disabled={adults===0}>−</button><b>{adults}</b><button type="button" onClick={()=>setAdults(adults+1)}>+</button></div></label>
            <label><span>Children <small>6–12 years</small></span><div className="stepper"><button type="button" onClick={()=>setChildren(Math.max(0,children-1))} disabled={children===0}>−</button><b>{children}</b><button type="button" onClick={()=>setChildren(children+1)}>+</button></div></label>
            {trip.buffetEnabled&&<div className="meal-options"><span>Meal option</span><button type="button" className={mealPlan==="without_buffet"?"meal-option active":"meal-option"} onClick={()=>setMealPlan("without_buffet")}><b>Trip only</b><small>Without buffet</small></button><button type="button" className={mealPlan==="with_buffet"?"meal-option active":"meal-option"} onClick={()=>setMealPlan("with_buffet")}><b>Trip + open buffet</b><small>{trip.buffetDescription||"Buffet included"}</small></button></div>}
            <label><span>Account</span><button><UserRound size={18}/>{auth?.user?.email || "Sign in during booking"}<ChevronRight size={17}/></button></label>
          </div>

          {error && error!=="AUTH_REQUIRED" && <div className="booking-error">{error}</div>}

          <div className="price-box">{adults>0&&<div><span>{adults} Adult{adults===1?"":"s"} × {Number(quote?.pricing?.adultUnitPrice ?? (mealPlan==="with_buffet"?trip.buffetAdultPrice:trip.price)).toFixed(2)}</span><b>{Number(quote?.pricing?.adultSubtotal ?? 0).toFixed(2)} JOD</b></div>}{children>0&&<div><span>{children} Child{children===1?"":"ren"} (6–12) × {Number(quote?.pricing?.childUnitPrice ?? (mealPlan==="with_buffet"?trip.buffetChildPrice:trip.childPrice)).toFixed(2)}</span><b>{Number(quote?.pricing?.childSubtotal ?? 0).toFixed(2)} JOD</b></div>}{trip.buffetEnabled&&<div><span>Package</span><b>{mealPlan==="with_buffet"?"Open buffet included":"Without buffet"}</b></div>}{mealPlan==="with_buffet"&&trip.buffetDescription&&<div><span>Buffet</span><b>{trip.buffetDescription}</b></div>}<div><span>Service fee</span><b>Included</b></div><hr/><div className="price-box__total"><span>Total</span><strong>{Number(total).toFixed(2)} JOD</strong></div></div>
          <button className="primary-button booking-confirm" onClick={confirm} disabled={live && (!selected || !quote)}>Continue to payment <ChevronRight size={18}/></button>
          <div className="cancellation-policy-note"><b>Cancellation policy</b><span>24+ hours: 100% refund · 12–24 hours: 50% · Less than 12 hours: no refund</span></div><p className="booking-note">No booking is created before payment. Successful payment creates the confirmed SeaGo booking and ticket.</p>
        </>
      )}
    </div>
  );
}

function FavouritesScreen({ favourites, tripList, onSelectTrip, toggleFavourite }) {
  const list=tripList.filter(t=>favourites.includes(t.id));
  return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>SAVED FOR LATER</span><h1>Favourites</h1></div></header>{list.length?<div className="trip-grid">{list.map(t=><TripCard key={t.id} trip={t} onSelectTrip={onSelectTrip} favourite toggleFavourite={toggleFavourite}/>)}</div>:<div className="empty-state"><Heart size={48}/><h2>No favourites yet</h2><p>Tap the heart on any experience to save it here.</p></div>}</div>;
}

function CancelBookingControl({ booking, token, onCancelled }) {
  const [open,setOpen]=useState(false);
  const [policy,setPolicy]=useState(null);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function showPolicy(){
    setError("");
    setOpen(true);
    setBusy(true);
    try{setPolicy(await getCancellationPolicy(booking._id,token));}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  }

  async function confirmCancel(){
    if(!policy)return;
    setBusy(true);setError("");
    try{
      const r=await cancelBooking(booking._id,reason,token);
      onCancelled?.(r);
    }catch(e){setError(e.message);}
    finally{setBusy(false);}
  }

  if(booking.status!=="confirmed")return null;

  return <div className="cancel-booking-control">
    {!open?<button type="button" className="cancel-booking-button" onClick={showPolicy}>Cancel booking</button>:
      <div className="cancel-sheet">
        <b>Cancellation policy</b>
        {busy&&!policy?<small>Checking refund...</small>:policy&&<>
          <p>You will receive <strong>{policy.refundPercentage}% refund</strong> ({Number(policy.refundAmount||0).toFixed(2)} {policy.currency}).</p>
          <ul>{policy.rules.map(r=><li key={r.label}>{r.label}: {r.refundPercentage}% refund</li>)}</ul>
          <textarea rows="2" placeholder="Reason for cancellation (optional)" value={reason} onChange={e=>setReason(e.target.value)}/>
          <div className="cancel-actions"><button type="button" onClick={()=>{setOpen(false);setPolicy(null)}}>Keep booking</button><button type="button" className="danger" disabled={busy} onClick={confirmCancel}>{busy?"Cancelling...":"Confirm cancellation"}</button></div>
        </>}
        {error&&<div className="booking-error">{error}</div>}
      </div>}
  </div>;
}

function TicketsScreen({ auth, onAuthenticated }) {
  const [tickets,setTickets]=useState([]);
  const [loading,setLoading]=useState(Boolean(auth?.token&&hasApi()));
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    let ignore=false;
    if(!hasApi()||!auth?.token){setLoading(false);setTickets([]);return;}
    setLoading(true);setError("");
    listBookings(auth.token)
      .then(rows=>{if(!ignore)setTickets(Array.isArray(rows)?rows:[]);})
      .catch(e=>{if(!ignore)setError(e.message||"Could not load tickets");})
      .finally(()=>{if(!ignore)setLoading(false);});
    return()=>{ignore=true;};
  },[auth?.token,revision]);

  if(hasApi()&&!auth?.token){
    return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header><div className="tickets-auth-copy"><Ticket size={38}/><h2>Sign in to view your tickets</h2><p>Your SeaGo bookings stay linked to your account.</p></div><AuthForm onAuthenticated={onAuthenticated}/></div>;
  }

  if(!hasApi()){
    return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header><div className="empty-state"><Ticket size={48}/><h2>Tickets are ready</h2><p>Once the live API is connected, confirmed bookings will appear here automatically with their QR ticket.</p></div></div>;
  }

  if(loading) return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header><LoadingState label="Loading tickets..."/></div>;

  if(error) return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header><div className="booking-error">{error}</div></div>;

  return <div className="screen standard-screen tickets-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header>{tickets.length?<div className="ticket-list">{tickets.map(b=>{
    const trip=b.tripId||{};
    const departure=b.departureId||{};
    const provider=b.providerId||{};
    const starts=departure.startsAt?new Date(departure.startsAt):null;
    const title=trip.titleEn||trip.titleAr||"Aqaba Sea Experience";
    const departureLocation=trip.departureLocation||{};
    const departureMapsUrl=departureLocation.googleMapsUrl || (departureLocation.address||departureLocation.name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(departureLocation.address||departureLocation.name)}` : "");
    const ref=String(b._id||"").slice(-8).toUpperCase();
    const status=String(b.status||"").replace("_"," ");
    const qrValue=b.ticketValidationUrl || `AQABA-SEAGO|BOOKING:${b._id}|REF:${ref}`;
    return <article className={`ticket-card ticket-card--${b.status}`} key={b._id}>
      <div className="ticket-card__top"><div><span className="ticket-kicker">AQABA SEAGO</span><h2>{title}</h2><p>{trip.category?CATEGORY_LABELS[trip.category]||trip.category:"Sea Experience"}</p>{provider.businessName&&<p className="ticket-provider">Provided by <strong>{provider.businessName}</strong></p>}</div><span className={`ticket-status ticket-status--${b.status}`}>{status}</span></div>
      <div className="ticket-card__details">
        <div><small>Date</small><strong>{starts?starts.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"TBA"}</strong></div>
        <div><small>Time</small><strong>{starts?starts.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}):"TBA"}</strong></div>
        <div><small>Guests</small><strong>{b.adults!==undefined?`${b.adults||0}A · ${b.children||0}C`:b.seats||1}</strong></div><div><small>Package</small><strong>{b.mealPlan==="with_buffet"?"With buffet":"No buffet"}</strong></div>
        <div><small>Total</small><strong>{Number(b.pricing?.grossAmount||0).toFixed(2)} {b.pricing?.currency||"JOD"}</strong></div>
      </div>
      <div className="ticket-card__location">{departureLocation.name&&<><small>Departure point</small><strong>{departureLocation.name}</strong>{departureLocation.address&&<span>{departureLocation.address}</span>}{departureMapsUrl&&<a className="ticket-map-button" href={departureMapsUrl} target="_blank" rel="noreferrer"><MapPin size={15}/> Open in Google Maps <ChevronRight size={14}/></a>}</>}</div><div className="ticket-card__footer"><div><small>Booking reference</small><strong>SG-{ref}</strong></div>{b.status==="confirmed"?<div className="ticket-qr"><QRCodeSVG value={qrValue} size={78} level="M" includeMargin={false}/><small>Scan to verify</small></div>:<div className="ticket-pending"><Ticket size={24}/><span>{b.status==="pending_payment"?"Awaiting payment":"Ticket unavailable"}</span></div>}</div>
    <CancelBookingControl booking={b} token={auth.token} onCancelled={()=>setRevision(x=>x+1)}/>{b.cancellation?.cancelledAt&&<div className="ticket-cancellation"><b>Cancelled</b><span>{b.cancellation.refundPercentage||0}% refund · {Number(b.cancellation.refundAmount||0).toFixed(2)} {b.pricing?.currency||"JOD"} · {b.cancellation.refundStatus||"none"}</span></div>}</article>;
  })}</div>:<div className="empty-state"><Ticket size={48}/><h2>No tickets yet</h2><p>Your confirmed SeaGo bookings will appear here.</p></div>}</div>;
}

function ProfileScreen({ auth, onAuthenticated, onSignOut }) {
  if(!auth?.token && hasApi()) {
    return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR SEAGO</span><h1>Profile</h1></div></header><AuthForm onAuthenticated={onAuthenticated}/></div>;
  }
  return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR SEAGO</span><h1>Profile</h1></div></header><div className="profile-card"><div className="profile-avatar">{auth?.user?.name?.[0]?.toUpperCase() || "M"}</div><div><h2>{auth?.user?.name || "Welcome aboard"}</h2><p>{auth?.user?.email || "Preview profile. Connect the API to sign in and manage bookings."}</p></div></div><div className="profile-menu"><button><span><Sparkles/> My bookings</span><ChevronRight/></button><button><span><Heart/> Favourites</span><ChevronRight/></button><button><span><UserRound/> Personal details</span><ChevronRight/></button>{auth?.token&&<button onClick={onSignOut}><span><UserRound/> Sign out</span><ChevronRight/></button>}</div></div>;
}

function PaymentReturnScreen({ onViewTicket }) {
  return (
    <div className="screen standard-screen booking-success">
      <BrandLogo />
      <CheckCircle2 size={76}/>
      <span>PAYMENT SUCCESSFUL</span>
      <h1>Booking confirmed</h1>
      <p>Your payment was completed successfully and your SeaGo ticket is ready.</p>
      <button className="primary-button" onClick={onViewTicket}>View ticket <Ticket size={18}/></button>
    </div>
  );
}

function LoadingState({ label }) {
  return <div className="loading-state"><LoaderCircle className="spin"/><span>{label}</span></div>;
}

function BottomNav({ active, setActive }) {
  const nav=[["home",Home,"Home"],["trips",ShipWheel,"Trips"],["tickets",Ticket,"Tickets"],["profile",UserRound,"Profile"]];
  return <nav className="bottom-nav">{nav.map(([id,Icon,label])=><button key={id} className={active===id?"active":""} onClick={()=>setActive(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>;
}

function readStoredAuth() {
  try { return JSON.parse(localStorage.getItem("seago_auth") || "null"); }
  catch { return null; }
}

export default function App(){
  const [active,setActive]=useState("home");
  const [detail,setDetail]=useState(null);
  const [booking,setBooking]=useState(false);
  const [tripList,setTripList]=useState(fallbackTrips);
  const [loadingTrips,setLoadingTrips]=useState(hasApi());
  const [usingFallback,setUsingFallback]=useState(!hasApi());
  const [searchResults,setSearchResults]=useState(null);
  const [searchSummary,setSearchSummary]=useState("");
  const [searchCriteria,setSearchCriteria]=useState(null);
  const [paymentReturn,setPaymentReturn]=useState(()=>new URLSearchParams(window.location.search).get("payment")==="success");
  const [favourites,setFavourites]=useState(["snorkel-coral"]);
  const [auth,setAuth]=useState(readStoredAuth());

  useEffect(()=>{
    let ignore=false;
    if(!hasApi()) return;
    listTrips()
      .then(rows=>{
        if(ignore) return;
        const normalized=rows.map(normalizeTrip);
        setTripList(normalized.length ? normalized : fallbackTrips);
        setUsingFallback(normalized.length===0);
      })
      .catch(()=>{
        if(!ignore){setTripList(fallbackTrips);setUsingFallback(true);}
      })
      .finally(()=>{if(!ignore)setLoadingTrips(false);});
    return()=>{ignore=true;};
  },[]);

  async function runHomeSearch({tripType,date,guests}) {
    setSearchCriteria({tripType,date,guests});
    let candidates = tripList;
    if (tripType !== "All Trips") {
      const token = tripType.replace(/s$/,"").toLowerCase();
      candidates = candidates.filter(t =>
        String(t.category||"").toLowerCase().includes(token) ||
        String(t.title||"").toLowerCase().includes(token)
      );
    }

    if (hasApi()) {
      const checks = await Promise.all(candidates.map(async trip => {
        if (!trip.apiId) return null;
        try {
          const deps = await listDepartures(trip.apiId);
          const ok = deps.some(d => {
            const enoughSeats = Number(d.availableSeats||0) >= Number(guests||1);
            if (!enoughSeats) return false;
            if (!date) return true;
            const depDate = new Date(d.startsAt).toISOString().slice(0,10);
            return depDate === date;
          });
          return ok ? trip : null;
        } catch { return null; }
      }));
      candidates = checks.filter(Boolean);
    }

    setSearchResults(candidates);
    const parts=[tripType!=="All Trips"?tripType:null,date?new Date(date+"T12:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"}):null,guests?guests+" guests":null].filter(Boolean);
    setSearchSummary(parts.length?parts.join(" · "):"DISCOVER AQABA");
    setActive("trips");
  }

  function viewPaidTicket() {
    setPaymentReturn(false);
    setDetail(null);
    setBooking(false);
    setActive("tickets");
    const url=new URL(window.location.href);
    url.searchParams.delete("payment");
    url.searchParams.delete("paymentId");
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
  }

  function saveAuth(data) {
    setAuth(data);
    localStorage.setItem("seago_auth",JSON.stringify(data));
  }

  function signOut() {
    setAuth(null);
    localStorage.removeItem("seago_auth");
  }

  const toggleFavourite=id=>setFavourites(x=>x.includes(id)?x.filter(v=>v!==id):[...x,id]);
  const openTrip=trip=>{setDetail(trip);setBooking(false);};

  if(paymentReturn) return <PaymentReturnScreen onViewTicket={viewPaidTicket}/>;
  if(booking&&detail) return <BookingScreen trip={detail} auth={auth} onAuthenticated={saveAuth} onBack={()=>setBooking(false)} initialCriteria={searchCriteria}/>;
  if(detail) return <DetailScreen trip={detail} onBack={()=>setDetail(null)} favourite={favourites.includes(detail.id)} toggleFavourite={toggleFavourite} onBook={()=>setBooking(true)}/>;

  return <div className="app-shell">
    <main>
      {active==="home"&&<HomeScreen tripList={tripList} onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite} usingFallback={usingFallback} onSearch={runHomeSearch}/>}
      {active==="trips"&&<TripsScreen tripList={searchResults??tripList} onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite} loading={loadingTrips} searchSummary={searchSummary}/>}
      {active==="tickets"&&<TicketsScreen auth={auth} onAuthenticated={saveAuth}/>}
      {active==="profile"&&<ProfileScreen auth={auth} onAuthenticated={saveAuth} onSignOut={signOut}/>}
    </main>
    <BottomNav active={active} setActive={setActive}/>
  </div>;
}
