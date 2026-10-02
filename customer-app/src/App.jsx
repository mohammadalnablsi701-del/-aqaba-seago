import React, { useMemo, useState } from "react";
import {
  Anchor, CalendarDays, ChevronLeft, ChevronRight, Heart, Home,
  MapPin, Search, ShipWheel, Sparkles, Star, UserRound, UsersRound
} from "lucide-react";
import BrandLogo from "./BrandLogo.jsx";
import { categories, trips } from "./data.js";

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

function HomeScreen({ onSelectTrip, favourites, toggleFavourite }) {
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
          <button className="search-row"><span className="search-row__icon"><Anchor size={18}/></span><span><small>Trip Type</small><strong>All Trips</strong></span><ChevronRight size={18}/></button>
          <button className="search-row"><span className="search-row__icon"><CalendarDays size={18}/></span><span><small>Date</small><strong>Select Date</strong></span><ChevronRight size={18}/></button>
          <button className="search-row"><span className="search-row__icon"><UsersRound size={18}/></span><span><small>Guests</small><strong>2 Guests</strong></span><ChevronRight size={18}/></button>
          <button className="primary-button"><Search size={18}/> Search Trips <ChevronRight size={18}/></button>
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading"><div><span>CURATED FOR YOU</span><h2>Popular Sea Experiences</h2></div><button>See all</button></div>
        <div className="trip-strip">
          {trips.slice(0,2).map(trip => (
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
      <div className={"trip-card__visual trip-card__visual--"+trip.accent}>
        <span className="trip-card__badge">{trip.category}</span>
        <button className={"heart-button "+(favourite?"is-active":"")} onClick={(e)=>{e.stopPropagation();toggleFavourite(trip.id);}}><Heart size={18} fill={favourite?"currentColor":"none"}/></button>
        <ShipWheel size={46} strokeWidth={1.5}/>
      </div>
      <div className="trip-card__body">
        <div className="rating"><Star size={14} fill="currentColor"/> {trip.rating} <span>({trip.reviews})</span></div>
        <h3>{trip.title}</h3>
        <p>{trip.subtitle}</p>
        <div className="trip-card__meta"><span>{trip.duration}</span><strong>From {trip.price} JOD</strong></div>
      </div>
    </article>
  );
}

function TripsScreen({ onSelectTrip, favourites, toggleFavourite }) {
  const [filter,setFilter]=useState("All Trips");
  const shown=useMemo(()=>filter==="All Trips"?trips:trips.filter(t=>t.category.includes(filter.replace("s",""))||t.title.includes(filter.replace("s",""))),[filter]);
  return (
    <div className="screen standard-screen">
      <header className="standard-header"><BrandLogo compact/><div><span>DISCOVER AQABA</span><h1>Sea Experiences</h1></div></header>
      <div className="category-row">{categories.map(c=><button className={filter===c?"active":""} onClick={()=>setFilter(c)} key={c}>{c}</button>)}</div>
      <div className="trip-grid">{shown.map(t=><TripCard key={t.id} trip={t} onSelectTrip={onSelectTrip} favourite={favourites.includes(t.id)} toggleFavourite={toggleFavourite}/>)}</div>
    </div>
  );
}

function DetailScreen({ trip, onBack, favourite, toggleFavourite, onBook }) {
  if(!trip) return null;
  return (
    <div className="screen detail-screen">
      <div className={"detail-hero detail-hero--"+trip.accent}>
        <button className="detail-back" onClick={onBack}><ChevronLeft/></button>
        <button className={"detail-heart "+(favourite?"is-active":"")} onClick={()=>toggleFavourite(trip.id)}><Heart fill={favourite?"currentColor":"none"}/></button>
        <BrandLogo compact/>
        <ShipWheel size={88} strokeWidth={1.1}/>
      </div>
      <div className="detail-body">
        <div className="detail-kicker">{trip.category} · Aqaba, Jordan</div>
        <h1>{trip.title}</h1>
        <div className="detail-rating"><Star size={16} fill="currentColor"/> {trip.rating} <span>{trip.reviews} reviews</span></div>
        <p className="detail-description">{trip.description}</p>
        <div className="feature-grid">
          <div><Anchor/><span><small>Experience</small><b>{trip.category}</b></span></div>
          <div><CalendarDays/><span><small>Duration</small><b>{trip.duration}</b></span></div>
          <div><UsersRound/><span><small>Guests</small><b>1–8 people</b></span></div>
          <div><MapPin/><span><small>Departure</small><b>Aqaba Marina</b></span></div>
        </div>
        <section className="included"><span>WHAT'S INCLUDED</span><h2>Everything for an easy day at sea</h2><p>Professional crew, safety equipment, bottled water and all essentials for this experience.</p></section>
      </div>
      <div className="sticky-booking"><div><small>From</small><strong>{trip.price} JOD</strong><span>/ booking</span></div><button className="primary-button" onClick={onBook}>Book now <ChevronRight size={18}/></button></div>
    </div>
  );
}

function BookingScreen({ trip, onBack, onFinish }) {
  const [guests,setGuests]=useState(2);
  const total=trip ? trip.price * (trip.category==="Yacht" ? 1 : guests) : 0;
  return (
    <div className="screen standard-screen booking-screen">
      <div className="booking-top"><button className="plain-back" onClick={onBack}><ChevronLeft/></button><BrandLogo compact/><span/></div>
      <div className="booking-title"><span>SECURE YOUR TRIP</span><h1>Complete booking</h1></div>
      <div className="booking-summary"><div className={"booking-thumb booking-thumb--"+trip.accent}><ShipWheel/></div><div><small>{trip.category}</small><h3>{trip.title}</h3><p>{trip.duration} · Aqaba Marina</p></div></div>
      <div className="booking-form">
        <label><span>Date</span><button><CalendarDays size={18}/> Friday, 9 October <ChevronRight size={17}/></button></label>
        <label><span>Guests</span><div className="stepper"><button onClick={()=>setGuests(Math.max(1,guests-1))}>−</button><b>{guests}</b><button onClick={()=>setGuests(guests+1)}>+</button></div></label>
        <label><span>Contact</span><button><UserRound size={18}/> Add guest details <ChevronRight size={17}/></button></label>
      </div>
      <div className="price-box"><div><span>Trip subtotal</span><b>{total} JOD</b></div><div><span>Service fee</span><b>Included</b></div><hr/><div className="price-box__total"><span>Total</span><strong>{total} JOD</strong></div></div>
      <button className="primary-button booking-confirm" onClick={onFinish}>Continue to payment <ChevronRight size={18}/></button>
      <p className="booking-note">Payment gateway connection is intentionally deferred. This button currently completes the UI flow only.</p>
    </div>
  );
}

function FavouritesScreen({ favourites, onSelectTrip, toggleFavourite }) {
  const list=trips.filter(t=>favourites.includes(t.id));
  return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>SAVED FOR LATER</span><h1>Favourites</h1></div></header>{list.length?<div className="trip-grid">{list.map(t=><TripCard key={t.id} trip={t} onSelectTrip={onSelectTrip} favourite toggleFavourite={toggleFavourite}/>)}</div>:<div className="empty-state"><Heart size={48}/><h2>No favourites yet</h2><p>Tap the heart on any experience to save it here.</p></div>}</div>;
}

function ProfileScreen() {
  return <div className="screen standard-screen"><header className="standard-header"><BrandLogo compact/><div><span>YOUR SEAGO</span><h1>Profile</h1></div></header><div className="profile-card"><div className="profile-avatar">M</div><div><h2>Welcome aboard</h2><p>Sign in later to manage bookings, favourites and trip details.</p></div></div><div className="profile-menu"><button><span><Sparkles/> My bookings</span><ChevronRight/></button><button><span><Heart/> Favourites</span><ChevronRight/></button><button><span><UserRound/> Personal details</span><ChevronRight/></button></div></div>;
}

function BottomNav({ active, setActive }) {
  const nav=[["home",Home,"Home"],["trips",ShipWheel,"Trips"],["favourites",Heart,"Favourites"],["profile",UserRound,"Profile"]];
  return <nav className="bottom-nav">{nav.map(([id,Icon,label])=><button key={id} className={active===id?"active":""} onClick={()=>setActive(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>;
}

export default function App(){
  const [active,setActive]=useState("home");
  const [detail,setDetail]=useState(null);
  const [booking,setBooking]=useState(false);
  const [favourites,setFavourites]=useState(["snorkel-coral"]);
  const toggleFavourite=id=>setFavourites(x=>x.includes(id)?x.filter(v=>v!==id):[...x,id]);
  const openTrip=trip=>{setDetail(trip);setBooking(false);};
  if(booking&&detail) return <BookingScreen trip={detail} onBack={()=>setBooking(false)} onFinish={()=>setActive("home")}/>;
  if(detail) return <DetailScreen trip={detail} onBack={()=>setDetail(null)} favourite={favourites.includes(detail.id)} toggleFavourite={toggleFavourite} onBook={()=>setBooking(true)}/>;
  return <div className="app-shell">
    <main>
      {active==="home"&&<HomeScreen onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite}/>}
      {active==="trips"&&<TripsScreen onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite}/>}
      {active==="favourites"&&<FavouritesScreen favourites={favourites} onSelectTrip={openTrip} toggleFavourite={toggleFavourite}/>}
      {active==="profile"&&<ProfileScreen/>}
    </main>
    <BottomNav active={active} setActive={setActive}/>
  </div>;
}
