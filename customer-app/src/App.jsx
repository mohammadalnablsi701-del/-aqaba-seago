import React, { useEffect, useMemo, useState } from "react";
import {
  Anchor, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Heart, Home,
  Bell, LoaderCircle, MapPin, Search, ShipWheel, Sparkles, Star, Ticket, UserRound, UsersRound
} from "lucide-react";
import BrandLogo from "./BrandLogo.jsx";
import { QRCodeSVG } from "qrcode.react";
import { categories, trips as fallbackTrips } from "./data.js";
import {
  createPaymentCheckout, getPayment, getQuote, hasApi, listBookings, listDepartures, listTrips,
  loginCustomer, registerCustomer, getCancellationPolicy, cancelBooking, listNotifications, markNotificationRead, markAllNotificationsRead, enablePushNotifications, pushNotificationStatus, sendTestPush
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
    providerName: raw.providerId?.businessName || "Aqaba SeaGo partner",
    verifiedProvider: true,
    duration: raw.durationMinutes ? `${raw.durationMinutes} min` : "Flexible",
    price: Number(raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    childPrice: Number(raw.pricing?.childPrice ?? raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    buffetEnabled: Boolean(raw.pricing?.buffetEnabled),
    buffetAdultPrice: Number(raw.pricing?.buffetAdultPrice ?? raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    buffetChildPrice: Number(raw.pricing?.buffetChildPrice ?? raw.pricing?.childPrice ?? raw.pricing?.adultPrice ?? raw.pricing?.pricePerPerson ?? 0),
    buffetDescription: String(raw.pricing?.buffetDescription || ""),
    images: String(raw.providerId?.businessName||"").includes("Demo Partner") ? [] : (Array.isArray(raw.images) ? raw.images.map(x=>typeof x==="string"?x:x?.url).filter(Boolean) : []),
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

function localDateInputValue(date=new Date()) {
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function HomeScreen({ tripList, onSelectTrip, favourites, toggleFavourite, usingFallback, onSearch, onOpenMenu, onSeeAll }) {
  const [tripType,setTripType]=useState("All Trips");
  const [date,setDate]=useState(()=>localDateInputValue());
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
          <button className="icon-button" aria-label="Menu" onClick={onOpenMenu}><span className="hamburger">☰</span></button>
        </div>
        <div className="hero__copy">
          <p className="eyebrow">ESCAPE · EXPLORE · REMEMBER</p>
          <h1>Make Aqaba<br/>Unforgettable</h1>
          <p>Your next Red Sea memory starts here.</p>
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
              <input type="date" value={date} min={localDateInputValue()} onChange={e=>setDate(e.target.value)}/>
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

      <section className="home-trust-strip" aria-label="SeaGo booking benefits">
        <div><CheckCircle2 size={16}/><span><b>Verified operators</b><small>Approved SeaGo partners</small></span></div>
        <div><CheckCircle2 size={16}/><span><b>Clear pricing</b><small>No hidden fees</small></span></div>
        <div><Ticket size={16}/><span><b>Instant ticket</b><small>After payment</small></span></div>
      </section>

      <section className="content-section">
        <div className="section-heading"><div><span>CURATED FOR YOU</span><h2>Popular Sea Experiences</h2><p>Trusted trips picked for an easy day on the Red Sea.</p></div><button onClick={onSeeAll}>See all <ChevronRight size={14}/></button></div>
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
        <div className="trip-card__trust"><span><CheckCircle2 size={14}/> Verified operator</span><small>Aqaba</small></div>
        <h3>{trip.title}</h3>
        <p>{trip.providerName || trip.subtitle}</p>
        <div className="trip-card__facts">
          <span><CalendarDays size={14}/>{trip.duration}</span>
          <span><MapPin size={14}/>{trip.departureLocation?.name || "Aqaba Marina"}</span>
        </div>
        <div className="trip-card__price"><span>From</span><strong>{trip.price} JOD</strong><small>per adult</small></div><div className="trip-card__cta">View experience <ChevronRight size={15}/></div>
      </div>
    </article>
  );
}

function TripsScreen({ tripList, onSelectTrip, favourites, toggleFavourite, loading, searchSummary }) {
  const [filter,setFilter]=useState("All Trips");
  const [sort,setSort]=useState("recommended");

  const shown=useMemo(()=>{
    let rows=filter==="All Trips" ? [...tripList] : tripList.filter(t=>{
      const token=filter.replace(/s$/,"").toLowerCase();
      return t.category.toLowerCase().includes(token) || t.title.toLowerCase().includes(token);
    });

    if(sort==="price-low") rows.sort((a,b)=>Number(a.price||0)-Number(b.price||0));
    if(sort==="price-high") rows.sort((a,b)=>Number(b.price||0)-Number(a.price||0));
    if(sort==="duration") rows.sort((a,b)=>{
      const am=Number(a.raw?.durationMinutes||parseInt(a.duration)||9999);
      const bm=Number(b.raw?.durationMinutes||parseInt(b.duration)||9999);
      return am-bm;
    });
    return rows;
  },[filter,sort,tripList]);

  return (
    <div className="screen standard-screen trips-screen">
      <header className="standard-header trips-header">
        <BrandLogo compact/>
        <div>
          <span>{searchSummary||"DISCOVER AQABA"}</span>
          <h1>Sea Experiences</h1>
          <p>Verified Red Sea trips, clear pricing and live availability.</p>
        </div>
      </header>

      <section className="trips-toolbar">
        <div className="category-row category-row--premium">
          {categories.map(c=><button className={filter===c?"active":""} onClick={()=>setFilter(c)} key={c}>{c}</button>)}
        </div>
        <div className="sort-row">
          <div><span>{shown.length}</span><small>{shown.length===1?"experience":"experiences"}</small></div>
          <label>Sort
            <select value={sort} onChange={e=>setSort(e.target.value)}>
              <option value="recommended">Recommended</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
              <option value="duration">Shortest first</option>
            </select>
          </label>
        </div>
      </section>

      {loading ? <LoadingState label="Finding the best sea experiences..."/> :
        shown.length
          ? <div className="trip-grid trip-grid--premium">{shown.map(t=><TripCard key={t.id} trip={t} onSelectTrip={onSelectTrip} favourite={favourites.includes(t.id)} toggleFavourite={toggleFavourite}/>)}</div>
          : <div className="empty-state trips-empty">
              <div className="trips-empty__icon"><Search size={28}/></div>
              <h2>No sea trips match this search</h2>
              <p>Try another date or category. SeaGo will show only experiences that match your current search.</p>
              <button onClick={()=>{setFilter("All Trips");setSort("recommended");}}>Show all experiences</button>
            </div>}
    </div>
  );
}

function DetailScreen({ trip, onBack, favourite, toggleFavourite, onBook }) {
  if(!trip) return null;
  return (
    <div className="screen detail-screen">
      <div className={"detail-hero detail-hero--"+trip.accent} style={trip.images?.[0]?{backgroundImage:`linear-gradient(rgba(3,31,51,.08),rgba(3,31,51,.34)),url("${trip.images[0]}")`,backgroundSize:"cover",backgroundPosition:"center"}:undefined}>
        <button className="detail-back" onClick={onBack} aria-label="Back"><ChevronLeft/></button>
        <button className={"detail-heart "+(favourite?"is-active":"")} onClick={()=>toggleFavourite(trip.id)} aria-label="Save trip"><Heart fill={favourite?"currentColor":"none"}/></button>
        <BrandLogo compact/>
        {!trip.images?.[0]&&<div className="detail-hero__fallback"><ShipWheel size={76} strokeWidth={1.15}/><span>{trip.category}</span></div>}
        <div className="detail-hero__badge"><CheckCircle2 size={14}/> Verified SeaGo experience</div>
      </div>

      <div className="detail-body">
        <div className="detail-kicker">{trip.category} · Aqaba, Jordan</div>
        <h1>{trip.title}</h1>
        <div className="detail-rating detail-rating--verified"><CheckCircle2 size={16}/> Verified operator <span>{trip.providerName || "Approved SeaGo partner"}</span></div>

        <div className="detail-price-summary">
          <div><small>From</small><strong>{trip.price} JOD</strong><span>per adult</span></div>
          <div><small>Duration</small><strong>{trip.duration}</strong><span>{trip.departureLocation?.name || "Aqaba"}</span></div>
        </div>

        <section className="detail-section">
          <span className="detail-section__label">ABOUT THIS EXPERIENCE</span>
          <p className="detail-description">{trip.description}</p>
        </section>

        <div className="detail-confidence">
          <div><CheckCircle2 size={18}/><span><b>Instant confirmation</b><small>Ticket issued after successful payment</small></span></div>
          <div><CheckCircle2 size={18}/><span><b>Flexible cancellation</b><small>100% refund 24+ hours before departure</small></span></div>
        </div>

        {trip.images?.length>1&&<div className="trip-gallery">{trip.images.slice(1,6).map((u,i)=><img key={u+i} src={u} alt={`${trip.title} ${i+2}`}/>)}</div>}

        <section className="detail-section">
          <span className="detail-section__label">TRIP ESSENTIALS</span>
          <div className="feature-grid">
            <div><Anchor/><span><small>Experience</small><b>{trip.category}</b></span></div>
            <div><CalendarDays/><span><small>Duration</small><b>{trip.duration}</b></span></div>
            <div><UsersRound/><span><small>Availability</small><b>Live seats</b></span></div>
            <div><MapPin/><span><small>Departure</small><b>{trip.departureLocation?.name || "Aqaba"}</b></span></div>
          </div>
        </section>

        {trip.buffetEnabled&&<section className="buffet-info detail-card-section"><span>OPEN BUFFET OPTION</span><h2>Add a meal to your trip</h2><p>{trip.buffetDescription||"Buffet details are provided by the operator."}</p></section>}

        {trip.departureLocation?.name&&<section className="departure-location detail-card-section"><span>DEPARTURE POINT</span><h2>{trip.departureLocation.name}</h2>{trip.departureLocation.address&&<p>{trip.departureLocation.address}</p>}{trip.departureLocation.googleMapsUrl&&<a href={trip.departureLocation.googleMapsUrl} target="_blank" rel="noreferrer">Open in Maps <ChevronRight size={15}/></a>}</section>}

        <section className="included detail-card-section">
          <span>CANCELLATION POLICY</span>
          <h2>Know your refund before you book</h2>
          <div className="policy-grid">
            <div><b>24+ hrs</b><small>100% refund</small></div>
            <div><b>12–24 hrs</b><small>50% refund</small></div>
            <div><b>&lt;12 hrs</b><small>No refund</small></div>
          </div>
        </section>
      </div>

      <div className="sticky-booking">
        <div><small>From</small><strong>{trip.price} JOD</strong><span>/ adult</span></div>
        <button className="primary-button" onClick={onBook}>Check availability <ChevronRight size={18}/></button>
      </div>
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
  const seatLimit=selected?.availableSeats!=null?Number(selected.availableSeats):20;
  const [departures,setDepartures]=useState([]);
  const [selected,setSelected]=useState(null);
  const [quote,setQuote]=useState(null);
  const [loading,setLoading]=useState(Boolean(trip.apiId && hasApi()));
  const [error,setError]=useState("");
  const [success,setSuccess]=useState(null);
  const [holdNow,setHoldNow]=useState(Date.now());
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
          const depDate=localDateInputValue(new Date(x.startsAt));
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
    if(!selected?.availableSeats) return;
    const cap=Number(selected.availableSeats);
    if(guests>cap){
      setChildren(0);
      setAdults(Math.max(1,Math.min(adults,cap)));
      setError(`This departure has ${cap} seat${cap===1?"":"s"} available. Guest count was adjusted.`);
    }
  },[selected?.id]);

  useEffect(()=>{
    let ignore=false;
    if(!live || !selected) { setQuote(null); return; }
    getQuote(selected.id,adults,children,mealPlan)
      .then(q=>{if(!ignore){setQuote(q);setError("");}})
      .catch(err=>{if(!ignore){setQuote(null);setError(err.message);}});
    return()=>{ignore=true;};
  },[selected,adults,children,mealPlan,live]);

  useEffect(()=>{
    if(!success?.expiresAt) return;
    setHoldNow(Date.now());
    const timer=setInterval(()=>setHoldNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[success?.expiresAt]);

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
      if(err.status===409) setError("This departure is no longer available for the selected guests. Please choose another departure or reduce the guest count.");
      else if(err.status===401||err.status===403) setError("AUTH_REQUIRED");
      else setError(err.message || "We couldn’t start secure payment. Please try again.");
    }
  }

  const holdRemaining=success?.expiresAt ? Math.max(0,new Date(success.expiresAt).getTime()-holdNow) : null;
  const holdExpired=holdRemaining===0;
  const holdMinutes=holdRemaining!=null?Math.floor(holdRemaining/60000):0;
  const holdSeconds=holdRemaining!=null?Math.floor((holdRemaining%60000)/1000):0;
  const total=quote?.pricing?.grossAmount ?? trip.price*guests;

  if(success) {
    return (
      <div className="screen standard-screen payment-handoff">
        <div className="payment-handoff__top"><BrandLogo /><span>STEP 2 OF 2</span></div>
        <div className="payment-handoff__icon"><CheckCircle2 size={34}/></div>
        <h1>{success.demo ? "Preview ready" : "Ready for secure payment"}</h1>
        <p>{success.demo ? "The booking flow is ready for the payment step." : "Your selected seats are temporarily protected. Complete payment to create the confirmed booking and QR ticket."}</p>
        <div className="payment-review-card">
          <div><span>Experience</span><b>{trip.title}</b></div>
          {selected?.startsAt&&<div><span>Departure</span><b>{formatDeparture(selected.startsAt)}</b></div>}
          <div><span>Guests</span><b>{adults} adult{adults===1?"":"s"}{children>0 ? " · "+children+" child"+(children===1?"":"ren") : ""}</b></div>
          <div><span>Total</span><strong>{Number(total).toFixed(2)} JOD</strong></div>
        </div>
        {!success.demo && success.expiresAt && <div className={"hold-box hold-box--secure "+(holdExpired?"is-expired":"")}><CheckCircle2 size={16}/><span>{holdExpired?<><b>Seat hold expired</b><small>Return to trip details to check availability again.</small></>:<>Seats reserved for <b>{String(holdMinutes).padStart(2,"0")}:{String(holdSeconds).padStart(2,"0")}</b><small>Complete payment before the timer ends.</small></>}</span></div>}
        <div className="payment-safety"><span><CheckCircle2 size={15}/> Booking created only after successful payment</span><span><CheckCircle2 size={15}/> QR ticket available immediately after confirmation</span></div>
        {!success.demo && success.checkoutUrl && <button className="primary-button payment-main-cta" disabled={holdExpired} onClick={()=>{if(!holdExpired)window.location.href=success.checkoutUrl;}}>{holdExpired?"Hold expired":"Pay securely · "+Number(total).toFixed(2)+" JOD"} {!holdExpired&&<ChevronRight size={18}/>}</button>}
        <button className="secondary-button payment-back" onClick={onBack}>{holdExpired?"Check availability again":"Back to trip details"}</button>
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

  return (
    <div className="screen standard-screen booking-screen">
      <div className="booking-top"><button className="plain-back" onClick={onBack}><ChevronLeft/></button><BrandLogo compact/><span/></div>
      <div className="booking-title"><span>BOOKING · STEP 1 OF 2</span><h1>Choose your trip details</h1><p className="booking-subtitle">Review the departure, guests and package before payment.</p>{initialCriteria?.date&&<p className="booking-search-context">Your search: {new Date(initialCriteria.date+"T12:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})} · {guests} {guests===1?"guest":"guests"}</p>}<div className="booking-progress"><i/><i/></div></div>
      <div className="booking-summary"><div className={"booking-thumb booking-thumb--"+trip.accent}><ShipWheel/></div><div><small>{trip.category}</small><h3>{trip.title}</h3><p>{trip.duration} · Aqaba</p><div className="booking-verified"><CheckCircle2 size={14}/> Verified operator</div></div></div>
      {trip.departureLocation?.name&&<div className="booking-location-card"><div><MapPin size={20}/><span><small>Departure point</small><strong>{trip.departureLocation.name}</strong>{trip.departureLocation.address&&<em>{trip.departureLocation.address}</em>}</span></div>{trip.departureLocation.googleMapsUrl&&<a href={trip.departureLocation.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps <ChevronRight size={16}/></a>}</div>}

      {loading ? <LoadingState label="Checking live departures"/> : (
        <>
          <div className="departure-block">
            <span>1 · CHOOSE DEPARTURE</span>
            {live && departures.length ? departures.slice(0,4).map(d=>(
              <button key={d.id} className={selected?.id===d.id?"departure-option active":"departure-option"} onClick={()=>setSelected(d)} disabled={d.availableSeats<1}>
                <CalendarDays size={17}/>
                <div><b>{formatDeparture(d.startsAt)}</b><small>{d.availableSeats} seats available</small></div>
                <CheckCircle2 size={17}/>
              </button>
            )) : live ? <div className="no-departures">No future departures are available yet.</div> : <div className="preview-departure"><CalendarDays size={18}/> Preview date · live dates appear after API deployment</div>}
          </div>

          <div className="booking-form booking-form--guests"><div className="booking-form__section-title">2 · GUESTS & PACKAGE</div>
            <label><span>Adults <small>13+</small></span><div className="stepper"><button type="button" onClick={()=>setAdults(Math.max(0,adults-1))} disabled={adults===0}>−</button><b>{adults}</b><button type="button" onClick={()=>setAdults(adults+1)} disabled={guests>=seatLimit}>+</button></div></label>
            <label><span>Children <small>6–12 years</small></span><div className="stepper"><button type="button" onClick={()=>setChildren(Math.max(0,children-1))} disabled={children===0}>−</button><b>{children}</b><button type="button" onClick={()=>setChildren(children+1)} disabled={guests>=seatLimit}>+</button></div></label>
            {trip.buffetEnabled&&<div className="meal-options"><span>Meal option</span><button type="button" className={mealPlan==="without_buffet"?"meal-option active":"meal-option"} onClick={()=>setMealPlan("without_buffet")}><b>Trip only</b><small>Without buffet</small></button><button type="button" className={mealPlan==="with_buffet"?"meal-option active":"meal-option"} onClick={()=>setMealPlan("with_buffet")}><b>Trip + open buffet</b><small>{trip.buffetDescription||"Buffet included"}</small></button></div>}
            <div className="booking-account-row"><span>Account</span><div><UserRound size={18}/><b>{auth?.user?.email || "Sign in during booking"}</b><CheckCircle2 size={16}/></div></div>
          </div>

          {error && error!=="AUTH_REQUIRED" && <div className="booking-error">{error}</div>}

          <div className="price-box"><div className="price-box__heading"><span>PRICE SUMMARY</span><small>No hidden fees</small></div>{adults>0&&<div><span>{adults} Adult{adults===1?"":"s"} × {Number(quote?.pricing?.adultUnitPrice ?? (mealPlan==="with_buffet"?trip.buffetAdultPrice:trip.price)).toFixed(2)}</span><b>{Number(quote?.pricing?.adultSubtotal ?? adults*(mealPlan==="with_buffet"?(trip.buffetAdultPrice||trip.price):trip.price)).toFixed(2)} JOD</b></div>}{children>0&&<div><span>{children} Child{children===1?"":"ren"} (6–12) × {Number(quote?.pricing?.childUnitPrice ?? (mealPlan==="with_buffet"?trip.buffetChildPrice:trip.childPrice)).toFixed(2)}</span><b>{Number(quote?.pricing?.childSubtotal ?? children*(mealPlan==="with_buffet"?(trip.buffetChildPrice||trip.childPrice||trip.price):(trip.childPrice||trip.price))).toFixed(2)} JOD</b></div>}{trip.buffetEnabled&&<div><span>Package</span><b>{mealPlan==="with_buffet"?"Open buffet included":"Without buffet"}</b></div>}{mealPlan==="with_buffet"&&trip.buffetDescription&&<div><span>Buffet</span><b>{trip.buffetDescription}</b></div>}<div><span>Service fee</span><b>Included</b></div><hr/><div className="price-box__total"><span>Total</span><strong>{Number(total).toFixed(2)} JOD</strong></div></div>
          <div className="checkout-trust-row"><span><CheckCircle2 size={15}/> Secure checkout</span><span><CheckCircle2 size={15}/> Instant ticket after payment</span></div><button className="primary-button booking-confirm" onClick={confirm} disabled={live && (!selected || !quote)}>Continue to secure payment <ChevronRight size={18}/></button>
          <div className="cancellation-policy-note"><b>Cancellation policy</b><span>24+ hours: 100% refund · 12–24 hours: 50% · Less than 12 hours: no refund</span></div><p className="booking-note">You will review the final amount before payment. Your booking and QR ticket are created only after successful payment.</p>
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

  if(error) return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>Tickets</h1></div></header><div className="ticket-error-state"><div className="booking-error">{error}</div><button className="secondary-button" onClick={()=>setRevision(x=>x+1)}>Try again</button></div></div>;

  return <div className="screen standard-screen tickets-screen"><header className="standard-header tickets-header"><BrandLogo compact/><div><span>YOUR BOOKINGS</span><h1>My SeaGo Tickets</h1><p>Everything you need for check-in, all in one place.</p></div></header>{tickets.length?<div className="ticket-list">{tickets.map(b=>{
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
      <div className="ticket-card__top"><div><span className="ticket-kicker">AQABA SEAGO TICKET</span><h2>{title}</h2><p>{trip.category?CATEGORY_LABELS[trip.category]||trip.category:"Sea Experience"}</p>{provider.businessName&&<p className="ticket-provider"><CheckCircle2 size={13}/> Verified operator · <strong>{provider.businessName}</strong></p>}</div><span className={`ticket-status ticket-status--${b.status}`}>{status}</span></div>
      {b.status==="confirmed"&&<div className="ticket-ready-banner"><CheckCircle2 size={16}/><span><b>Ready for check-in</b><small>Keep this ticket open when you arrive</small></span></div>}
      <div className="ticket-card__details">
        <div><small>Date</small><strong>{starts?starts.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"TBA"}</strong></div>
        <div><small>Time</small><strong>{starts?starts.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}):"TBA"}</strong></div>
        <div><small>Guests</small><strong>{b.adults!==undefined?`${b.adults||0}A · ${b.children||0}C`:b.seats||1}</strong></div><div><small>Package</small><strong>{b.mealPlan==="with_buffet"?"With buffet":"No buffet"}</strong></div>
        <div><small>Total</small><strong>{Number(b.pricing?.grossAmount||0).toFixed(2)} {b.pricing?.currency||"JOD"}</strong></div>
      </div>
      <div className="ticket-card__location">{departureLocation.name&&<><div className="ticket-location-title"><MapPin size={16}/><span><small>Departure point</small><strong>{departureLocation.name}</strong></span></div>{departureLocation.address&&<span>{departureLocation.address}</span>}{departureMapsUrl&&<a className="ticket-map-button" href={departureMapsUrl} target="_blank" rel="noreferrer"><MapPin size={15}/> Open in Google Maps <ChevronRight size={14}/></a>}</>}</div><div className="ticket-card__footer"><div><small>Booking reference</small><strong>SG-{ref}</strong>{b.status==="confirmed"&&<span className="ticket-ref-note">Use this if you need support</span>}</div>{b.status==="confirmed"?<div className="ticket-qr"><QRCodeSVG value={qrValue} size={92} level="M" includeMargin={false}/><small>Show at check-in</small></div>:<div className="ticket-pending"><Ticket size={24}/><span>{b.status==="pending_payment"?"Awaiting payment":"Ticket unavailable"}</span></div>}</div>
    <CancelBookingControl booking={b} token={auth.token} onCancelled={()=>setRevision(x=>x+1)}/>{b.cancellation?.cancelledAt&&<div className="ticket-cancellation"><b>Cancelled</b><span>{b.cancellation.refundPercentage||0}% refund · {Number(b.cancellation.refundAmount||0).toFixed(2)} {b.pricing?.currency||"JOD"} · {b.cancellation.refundStatus||"none"}</span></div>}</article>;
  })}</div>:<div className="empty-state ticket-empty"><Ticket size={48}/><h2>No trips booked yet</h2><p>Once you book a SeaGo experience, your QR ticket and departure details will appear here.</p></div>}</div>;
}

function ProfileScreen({ auth, onAuthenticated, onSignOut, navigate }) {
  if(!auth?.token && hasApi()) {
    return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR SEAGO</span><h1>Profile</h1><p className="profile-header-copy">Sign in to manage bookings, tickets and saved trips.</p></div></header><AuthForm onAuthenticated={onAuthenticated}/></div>;
  }

  const initial=auth?.user?.name?.trim()?.[0]?.toUpperCase() || "M";
  return <div className="screen standard-screen profile-screen">
    <header className="standard-header profile-header"><BrandLogo compact/><div><span>YOUR SEAGO</span><h1>Profile</h1><p className="profile-header-copy">Your trips, preferences and account in one place.</p></div></header>

    <section className="profile-hero-card">
      <div className="profile-avatar profile-avatar--large">{initial}</div>
      <div className="profile-hero-card__copy">
        <small>SEAGO MEMBER</small>
        <h2>{auth?.user?.name || "Welcome aboard"}</h2>
        <p>{auth?.user?.email || "Preview profile"}</p>
      </div>
      <div className="profile-member-badge"><CheckCircle2 size={15}/> Active</div>
    </section>

    <section className="profile-quick-grid">
      <button onClick={()=>navigate("tickets")}><Ticket size={20}/><span><b>My tickets</b><small>View confirmed bookings</small></span><ChevronRight size={17}/></button>
      <button onClick={()=>navigate("favourites")}><Heart size={20}/><span><b>Saved trips</b><small>Your favourites</small></span><ChevronRight size={17}/></button>
      <button onClick={()=>navigate("notifications")}><Bell size={20}/><span><b>Notifications</b><small>Trip updates & reminders</small></span><ChevronRight size={17}/></button>
    </section>

    <section className="profile-section">
      <div className="profile-section__title"><span>ACCOUNT</span><small>Manage your SeaGo details</small></div>
      <div className="profile-list">
        <button onClick={()=>navigate("personal-details")}><span className="profile-list__icon"><UserRound size={18}/></span><span><b>Personal details</b><small>Name, email and phone</small></span><ChevronRight size={17}/></button>
        <button onClick={()=>navigate("trip-preferences")}><span className="profile-list__icon"><MapPin size={18}/></span><span><b>Trip preferences</b><small>Saved experiences and interests</small></span><ChevronRight size={17}/></button>
      </div>
    </section>

    <section className="profile-section">
      <div className="profile-section__title"><span>HELP & INFO</span><small>Everything you may need</small></div>
      <div className="profile-list">
        <button onClick={()=>navigate("support")}><span className="profile-list__icon"><Sparkles size={18}/></span><span><b>Help & support</b><small>Get help with a booking</small></span><ChevronRight size={17}/></button>
        <button onClick={()=>navigate("policies")}><span className="profile-list__icon"><CheckCircle2 size={18}/></span><span><b>Policies</b><small>Cancellation, refunds and privacy</small></span><ChevronRight size={17}/></button>
      </div>
    </section>

    {auth?.token&&<button className="profile-signout" onClick={onSignOut}>Sign out</button>}
    <div className="profile-footer-copy">Aqaba SeaGo · Red Sea experiences</div>
  </div>;
}

function ProfileSubHeader({ eyebrow, title, subtitle, onBack }) {
  return <header className="profile-sub-header">
    <button className="plain-back" onClick={onBack}><ChevronLeft/></button>
    <div><span>{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
  </header>;
}

function PersonalDetailsScreen({ auth, onBack }) {
  const user=auth?.user||{};
  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="ACCOUNT" title="Personal details" subtitle="Your SeaGo account information." onBack={onBack}/>
    <section className="profile-detail-card">
      <div><span className="profile-detail-icon"><UserRound size={18}/></span><span><small>Full name</small><b>{user.name||"Not provided"}</b></span></div>
      <div><span className="profile-detail-icon"><Sparkles size={18}/></span><span><small>Email</small><b>{user.email||"Not provided"}</b></span></div>
      <div><span className="profile-detail-icon"><UserRound size={18}/></span><span><small>Phone</small><b>{user.phone||"Not provided"}</b></span></div>
    </section>
    <div className="profile-sub-note"><CheckCircle2 size={16}/><span>Your booking confirmations and tickets stay linked to this account.</span></div>
  </div>;
}

function TripPreferencesScreen({ favourites, navigate, onBack }) {
  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="YOUR SEAGO" title="Trip preferences" subtitle="Keep the experiences you love close." onBack={onBack}/>
    <section className="preference-hero">
      <Heart size={24}/>
      <div><h2>{favourites.length} saved trip{favourites.length===1?"":"s"}</h2><p>Your favourites help you return quickly to the experiences you liked.</p></div>
    </section>
    <div className="profile-action-list">
      <button onClick={()=>navigate("favourites")}><Heart size={19}/><span><b>Open saved trips</b><small>Review your favourites</small></span><ChevronRight size={17}/></button>
      <button onClick={()=>navigate("trips")}><ShipWheel size={19}/><span><b>Explore more experiences</b><small>Find something new in Aqaba</small></span><ChevronRight size={17}/></button>
    </div>
  </div>;
}

function SupportScreen({ navigate, onBack }) {
  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="HELP & SUPPORT" title="How can we help?" subtitle="Quick answers for your SeaGo trip." onBack={onBack}/>
    <section className="support-highlight">
      <Ticket size={24}/><div><h2>Need help with a booking?</h2><p>Open My Tickets first — your booking reference, operator and departure point are all there.</p></div>
      <button onClick={()=>navigate("tickets")}>My tickets <ChevronRight size={16}/></button>
    </section>
    <div className="support-faq">
      <details><summary>Where is my departure point?</summary><p>Open your ticket to see the departure location and the Google Maps shortcut when provided by the operator.</p></details>
      <details><summary>When do I receive my QR ticket?</summary><p>Your QR ticket becomes available after successful payment and confirmed booking creation.</p></details>
      <details><summary>What if I need to cancel?</summary><p>Open your ticket and use the cancellation option. The refund amount is shown before you confirm.</p></details>
    </div>
  </div>;
}

function PoliciesScreen({ onBack }) {
  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="HELP & INFO" title="Policies" subtitle="Clear rules before and after you book." onBack={onBack}/>
    <section className="policy-page-card">
      <span>CANCELLATION & REFUNDS</span>
      <h2>Know your refund before cancelling</h2>
      <div className="policy-grid">
        <div><b>24+ hrs</b><small>100% refund</small></div>
        <div><b>12–24 hrs</b><small>50% refund</small></div>
        <div><b>&lt;12 hrs</b><small>No refund</small></div>
      </div>
      <p>If an operator cancels a departure, confirmed bookings are eligible for a full refund under the current SeaGo policy.</p>
    </section>
    <section className="policy-page-card">
      <span>BOOKING & PAYMENT</span>
      <h2>Confirmation happens after payment</h2>
      <p>Your booking and QR ticket are created only after successful payment. Seats may be temporarily held during checkout.</p>
    </section>
    <section className="policy-page-card">
      <span>PRIVACY</span>
      <h2>Your account stays connected to your trips</h2>
      <p>SeaGo uses your account details to manage bookings, tickets and trip notifications. A full production privacy policy will be published before public launch.</p>
    </section>
  </div>;
}

function PaymentReturnScreen({ auth, onViewTicket, onReturnHome }) {
  const params=new URLSearchParams(window.location.search);
  const paymentId=params.get("paymentId");
  const gatewayState=params.get("payment");
  const [state,setState]=useState({loading:Boolean(paymentId&&auth?.token),payment:null,error:""});

  async function verify(){
    if(!paymentId||!auth?.token){
      setState({loading:false,payment:null,error:!auth?.token?"Your SeaGo session is required to verify this payment.":"Payment reference is missing."});
      return;
    }
    setState(s=>({...s,loading:true,error:""}));
    try{
      const payment=await getPayment(paymentId,auth.token);
      setState({loading:false,payment,error:""});
    }catch(e){
      setState({loading:false,payment:null,error:e.message||"We couldn’t verify this payment yet."});
    }
  }

  useEffect(()=>{verify();},[paymentId,auth?.token]);

  const status=String(state.payment?.status||gatewayState||"").toLowerCase();
  const confirmed=status==="paid"&&Boolean(state.payment?.bookingId);
  const pending=["pending","processing","success"].includes(status)&&!confirmed;
  const failed=["failed","cancelled","expired"].includes(status);
  const review=status==="needs_review";

  if(state.loading) return <div className="screen standard-screen payment-result-screen">
    <div className="confirmation-screen__brand"><BrandLogo /></div>
    <div className="payment-result-loader"><LoaderCircle className="spin" size={34}/></div>
    <span className="confirmation-kicker">VERIFYING PAYMENT</span>
    <h1>Confirming your booking…</h1>
    <p>Please keep this page open while SeaGo checks the payment status.</p>
  </div>;

  if(confirmed) return <div className="screen standard-screen confirmation-screen">
    <div className="confirmation-screen__brand"><BrandLogo /></div>
    <div className="confirmation-check"><CheckCircle2 size={44}/></div>
    <span className="confirmation-kicker">BOOKING CONFIRMED</span>
    <h1>You’re going to the Red Sea.</h1>
    <p>Your payment was verified successfully. Your booking is confirmed and your QR ticket is ready.</p>
    <div className="confirmation-card">
      <div><Ticket size={22}/><span><b>Your digital ticket is ready</b><small>Show the QR ticket at check-in</small></span></div>
      <div><Bell size={22}/><span><b>We’ll keep you updated</b><small>Trip reminders and important changes appear in Alerts</small></span></div>
      <div><MapPin size={22}/><span><b>Departure details included</b><small>Your ticket includes the meeting point and trip information</small></span></div>
    </div>
    <button className="primary-button confirmation-cta" onClick={onViewTicket}>Open my ticket <Ticket size={18}/></button>
    <small className="confirmation-note">Keep your ticket available on your phone for check-in.</small>
  </div>;

  return <div className="screen standard-screen payment-result-screen">
    <div className="confirmation-screen__brand"><BrandLogo /></div>
    <div className={"payment-result-icon "+(failed?"is-failed":review?"is-review":"is-pending")}>{failed?"!":review?"!":"…"}</div>
    <span className="confirmation-kicker">{failed?"PAYMENT NOT COMPLETED":review?"PAYMENT REVIEW":"PAYMENT STATUS"}</span>
    <h1>{failed?"Your booking was not confirmed.":review?"We’re checking this payment.":pending?"Payment is still processing.":"We couldn’t confirm the payment yet."}</h1>
    <p>{failed?"No confirmed booking or QR ticket has been issued. You can return and try again.":review?"Please don’t pay again. SeaGo needs to verify the payment before issuing a ticket.":pending?"Please wait a moment, then check again. Your ticket will appear only after payment is verified.":state.error||"SeaGo could not verify a confirmed payment for this return."}</p>
    {state.error&&<div className="booking-error">{state.error}</div>}
    {(pending||review||state.error)&&<button className="primary-button payment-result-action" onClick={verify}>Check payment again</button>}
    <button className="secondary-button payment-result-action" onClick={onReturnHome}>Return to SeaGo</button>
  </div>;
}

function LoadingState({ label }) {
  return <div className="loading-state"><LoaderCircle className="spin"/><span>{label}</span></div>;
}

function NotificationsScreen({auth,onUnreadChange,onAuthenticated}){
  const[data,setData]=useState({unread:0,items:[]});const[loading,setLoading]=useState(Boolean(auth?.token));const[error,setError]=useState("");
  const[push,setPush]=useState({supported:true,permission:"default",subscribed:false});const[pushBusy,setPushBusy]=useState(false);const[pushMsg,setPushMsg]=useState("");
  const standalone=window.matchMedia?.("(display-mode: standalone)")?.matches||window.navigator.standalone===true;
  const isiPhone=/iPhone|iPad|iPod/i.test(navigator.userAgent);

  async function load(){if(!auth?.token){setLoading(false);onUnreadChange?.(0);return;}setLoading(true);try{const next=await listNotifications(auth.token);setData(next);onUnreadChange?.(Number(next?.unread||0));setError("");}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load();pushNotificationStatus().then(setPush).catch(()=>{})},[auth?.token]);
  async function open(n){if(!n.readAt){try{await markNotificationRead(n._id,auth.token);setData(d=>{const unread=Math.max(0,d.unread-1);onUnreadChange?.(unread);return {...d,unread,items:d.items.map(x=>x._id===n._id?{...x,readAt:new Date().toISOString()}:x)}})}catch{}}}
  async function readAll(){await markAllNotificationsRead(auth.token);onUnreadChange?.(0);setData(d=>({unread:0,items:d.items.map(x=>({...x,readAt:x.readAt||new Date().toISOString()}))}))}
  async function enablePush(){setPushBusy(true);setPushMsg("");try{await enablePushNotifications(auth.token);setPush(await pushNotificationStatus());setPushMsg("Push notifications enabled.");}catch(e){setPushMsg(e.message)}finally{setPushBusy(false)}}
  async function testPush(){setPushBusy(true);setPushMsg("");try{const r=await sendTestPush(auth.token);setPushMsg(r.sent>0?"Test push sent.":"No active push subscription found.");}catch(e){setPushMsg(e.message)}finally{setPushBusy(false)}}

  if(!auth?.token)return <div className="screen standard-screen notification-screen"><header className="standard-header notifications-header"><BrandLogo compact/><div><span>TRIP UPDATES</span><h1>Alerts</h1><p>Booking confirmations, reminders and important changes.</p></div></header><div className="alerts-signin"><div className="alerts-signin__icon"><Bell size={28}/></div><h2>Stay in the loop</h2><p>Sign in to receive booking updates, departure reminders and important SeaGo alerts.</p></div><AuthForm onAuthenticated={onAuthenticated}/></div>;

  return <div className="screen standard-screen notification-screen">
    <header className="standard-header notifications-header"><BrandLogo compact/><div><span>TRIP UPDATES</span><h1>Alerts</h1><p>Everything important about your SeaGo trips.</p></div>{data.unread>0&&<button className="mark-all" onClick={readAll}>Read all</button>}</header>

    <section className={"push-card push-card--premium "+(push.subscribed?"is-enabled":"")}>
      <div className="push-card__icon"><Bell size={20}/></div>
      <div className="push-card__copy"><b>{push.subscribed?"Push alerts are on":"Never miss a trip update"}</b><span>{push.subscribed?"You’ll get important SeaGo alerts on this device.":"Enable push for booking confirmations, reminders and last-minute changes."}</span></div>
      {!push.subscribed&&push.supported&&<button disabled={pushBusy||(isiPhone&&!standalone)} onClick={enablePush}>{pushBusy?"Enabling...":"Enable"}</button>}
      {push.subscribed&&<button disabled={pushBusy} onClick={testPush}>Test</button>}
      {isiPhone&&!standalone&&<small>Add SeaGo to your Home Screen first, then open it there to enable push notifications.</small>}
      {push.permission==="denied"&&<small>Notifications are blocked in your iPhone settings for SeaGo.</small>}
      {pushMsg&&<small>{pushMsg}</small>}
    </section>

    <div className="alerts-summary">
      <div><b>{data.unread}</b><span>Unread</span></div>
      <div><b>{data.items.length}</b><span>Total alerts</span></div>
      <div><b>{push.subscribed?"On":"Off"}</b><span>Push</span></div>
    </div>

    {loading?<LoadingState label="Loading alerts..."/>:error?<div className="booking-error">{error}</div>:data.items.length?
      <div className="notification-list notification-list--premium">{data.items.map(n=>{
        const t=String(n.title||"").toLowerCase();
        const Icon=t.includes("cancel")?CalendarDays:t.includes("booking")||t.includes("confirm")?Ticket:t.includes("remind")?Bell:CheckCircle2;
        return <button key={n._id} className={"notification-card "+(!n.readAt?"unread":"")} onClick={()=>open(n)}>
          <div className="notification-icon"><Icon size={18}/></div>
          <div className="notification-card__copy"><div className="notification-card__top"><b>{n.title}</b>{!n.readAt&&<span className="notification-new">NEW</span>}</div><p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"numeric",minute:"2-digit"})}</small></div>
          <ChevronRight size={17} className="notification-chevron"/>
        </button>
      })}</div>
      :<div className="empty-state alerts-empty"><div className="alerts-empty__icon"><Bell size={28}/></div><h2>You’re all caught up</h2><p>Booking confirmations, reminders and important trip changes will appear here.</p></div>}
  </div>
}

function SideMenu({ open, onClose, active, setActive }) {
  const items=[
    ["home",Home,"Home"],
    ["trips",ShipWheel,"Sea Experiences"],
    ["tickets",Ticket,"My Tickets"],
    ["favourites",Heart,"Favourites"],
    ["notifications",Bell,"Alerts"],
    ["profile",UserRound,"Profile"]
  ];
  if(!open) return null;
  return <div className="side-menu-layer">
    <button className="side-menu-backdrop" aria-label="Close menu" onClick={onClose}/>
    <aside className="side-menu" aria-label="Main menu">
      <div className="side-menu__head"><BrandLogo/><button className="side-menu__close" onClick={onClose} aria-label="Close menu">×</button></div>
      <div className="side-menu__eyebrow">EXPLORE AQABA</div>
      <nav>{items.map(([id,Icon,label])=><button key={id} className={active===id?"active":""} onClick={()=>{setActive(id);onClose();}}><Icon size={20}/><span>{label}</span><ChevronRight size={17}/></button>)}</nav>
      <div className="side-menu__footer">Aqaba SeaGo · Red Sea experiences</div>
    </aside>
  </div>;
}

function BottomNav({ active, setActive, unread = 0 }) {
  const nav=[["home",Home,"Home"],["trips",ShipWheel,"Trips"],["tickets",Ticket,"Tickets"],["notifications",Bell,"Alerts"],["profile",UserRound,"Profile"]];
  return <nav className="bottom-nav">{nav.map(([id,Icon,label])=><button key={id} className={active===id?"active":""} onClick={()=>setActive(id)}><span className="bottom-nav__icon"><Icon size={20}/>{id==="notifications"&&unread>0&&<em>{unread>9?"9+":unread}</em>}</span><span>{label}</span></button>)}</nav>;
}

function readStoredAuth() {
  try { return JSON.parse(localStorage.getItem("seago_auth") || "null"); }
  catch { return null; }
}

export default function App(){
  const [active,setActive]=useState(()=>new URLSearchParams(window.location.search).get("open")==="notifications"?"notifications":"home");
  const [detail,setDetail]=useState(null);
  const [booking,setBooking]=useState(false);
  const [tripList,setTripList]=useState(fallbackTrips);
  const [loadingTrips,setLoadingTrips]=useState(hasApi());
  const [usingFallback,setUsingFallback]=useState(!hasApi());
  const [searchResults,setSearchResults]=useState(null);
  const [searchSummary,setSearchSummary]=useState("");
  const [searchCriteria,setSearchCriteria]=useState(null);
  const [paymentReturn,setPaymentReturn]=useState(()=>new URLSearchParams(window.location.search).get("payment")==="success");
  const [favourites,setFavourites]=useState(()=>{try{return JSON.parse(localStorage.getItem("seago_favourites")||"[\"snorkel-coral\"]")}catch{return ["snorkel-coral"]}});
  const [auth,setAuth]=useState(readStoredAuth());
  const [menuOpen,setMenuOpen]=useState(false);
  const [alertsUnread,setAlertsUnread]=useState(0);

  useEffect(()=>{
    let ignore=false;
    if(!auth?.token||!hasApi()){setAlertsUnread(0);return;}
    listNotifications(auth.token).then(r=>{if(!ignore)setAlertsUnread(Number(r?.unread||0));}).catch(()=>{});
    return()=>{ignore=true;};
  },[auth?.token,active]);

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
            const depDate = localDateInputValue(new Date(d.startsAt));
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

  useEffect(()=>{
    window.scrollTo(0,0);
  },[active,detail?.id,booking,paymentReturn]);

  const toggleFavourite=id=>setFavourites(x=>{const next=x.includes(id)?x.filter(v=>v!==id):[...x,id];localStorage.setItem("seago_favourites",JSON.stringify(next));return next;});
  const openTrip=trip=>{setDetail(trip);setBooking(false);};

  if(paymentReturn) return <PaymentReturnScreen auth={auth} onViewTicket={viewPaidTicket} onReturnHome={()=>{setPaymentReturn(false);setActive("home");const url=new URL(window.location.href);url.searchParams.delete("payment");url.searchParams.delete("paymentId");window.history.replaceState({},"",url.pathname+(url.search?url.search:""));}}/>;
  if(booking&&detail) return <BookingScreen trip={detail} auth={auth} onAuthenticated={saveAuth} onBack={()=>setBooking(false)} initialCriteria={searchCriteria}/>;
  if(detail) return <DetailScreen trip={detail} onBack={()=>setDetail(null)} favourite={favourites.includes(detail.id)} toggleFavourite={toggleFavourite} onBook={()=>setBooking(true)}/>;

  return <div className="app-shell">
    <main>
      {active==="home"&&<HomeScreen tripList={tripList} onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite} usingFallback={usingFallback} onSearch={runHomeSearch} onOpenMenu={()=>setMenuOpen(true)} onSeeAll={()=>{setSearchResults(null);setSearchSummary("");setActive("trips");}}/>}
      {active==="trips"&&<TripsScreen tripList={searchResults??tripList} onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite} loading={loadingTrips} searchSummary={searchSummary}/>}
      {active==="tickets"&&<TicketsScreen auth={auth} onAuthenticated={saveAuth}/>}
      {active==="favourites"&&<FavouritesScreen favourites={favourites} tripList={tripList} onSelectTrip={openTrip} toggleFavourite={toggleFavourite}/>}
      {active==="notifications"&&<NotificationsScreen auth={auth} onUnreadChange={setAlertsUnread}/>}
      {active==="profile"&&<ProfileScreen auth={auth} onAuthenticated={saveAuth} onSignOut={signOut} navigate={setActive}/>}
      {active==="personal-details"&&<PersonalDetailsScreen auth={auth} onBack={()=>setActive("profile")}/>}
      {active==="trip-preferences"&&<TripPreferencesScreen favourites={favourites} navigate={setActive} onBack={()=>setActive("profile")}/>}
      {active==="support"&&<SupportScreen navigate={setActive} onBack={()=>setActive("profile")}/>}
      {active==="policies"&&<PoliciesScreen onBack={()=>setActive("profile")}/>}
    </main>
    <SideMenu open={menuOpen} onClose={()=>setMenuOpen(false)} active={active} setActive={setActive}/>
    <BottomNav active={["personal-details","trip-preferences","support","policies"].includes(active)?"profile":active} setActive={setActive} unread={alertsUnread}/>
  </div>;
}
