import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Heart, Home,
  Bell, LoaderCircle, MapPin, Search, ShipWheel, Sparkles, Star, Ticket, UserRound, UsersRound
} from "lucide-react";
import BrandLogo from "./BrandLogo.jsx";
import { useLanguage } from "./i18n.jsx";
import { QRCodeSVG } from "qrcode.react";
import { categories, trips as fallbackTrips } from "./data.js";
import {
  createPaymentCheckout, getPayment, getQuote, hasApi, listBookings, listDepartures, listTrips,
  loginCustomer, registerCustomer, listNotifications, markNotificationRead, markAllNotificationsRead, enablePushNotifications, pushNotificationStatus, sendTestPush, googleAuthConfig, googleSignIn, saveAccountPhone, createSupportRequest
} from "./api.js";

const COUNTRY_CODES=[
["JO","🇯🇴 Jordan","+962"],
["AF","🇦🇫 Afghanistan","+93"],["AL","🇦🇱 Albania","+355"],["DZ","🇩🇿 Algeria","+213"],["AS","🇦🇸 American Samoa","+1684"],["AD","🇦🇩 Andorra","+376"],["AO","🇦🇴 Angola","+244"],["AI","🇦🇮 Anguilla","+1264"],["AG","🇦🇬 Antigua & Barbuda","+1268"],["AR","🇦🇷 Argentina","+54"],["AM","🇦🇲 Armenia","+374"],["AW","🇦🇼 Aruba","+297"],["AU","🇦🇺 Australia","+61"],["AT","🇦🇹 Austria","+43"],["AZ","🇦🇿 Azerbaijan","+994"],
["BS","🇧🇸 Bahamas","+1242"],["BH","🇧🇭 Bahrain","+973"],["BD","🇧🇩 Bangladesh","+880"],["BB","🇧🇧 Barbados","+1246"],["BY","🇧🇾 Belarus","+375"],["BE","🇧🇪 Belgium","+32"],["BZ","🇧🇿 Belize","+501"],["BJ","🇧🇯 Benin","+229"],["BM","🇧🇲 Bermuda","+1441"],["BT","🇧🇹 Bhutan","+975"],["BO","🇧🇴 Bolivia","+591"],["BA","🇧🇦 Bosnia & Herzegovina","+387"],["BW","🇧🇼 Botswana","+267"],["BR","🇧🇷 Brazil","+55"],["BN","🇧🇳 Brunei","+673"],["BG","🇧🇬 Bulgaria","+359"],["BF","🇧🇫 Burkina Faso","+226"],["BI","🇧🇮 Burundi","+257"],
["KH","🇰🇭 Cambodia","+855"],["CM","🇨🇲 Cameroon","+237"],["CA","🇨🇦 Canada","+1"],["CV","🇨🇻 Cape Verde","+238"],["KY","🇰🇾 Cayman Islands","+1345"],["CF","🇨🇫 Central African Republic","+236"],["TD","🇹🇩 Chad","+235"],["CL","🇨🇱 Chile","+56"],["CN","🇨🇳 China","+86"],["CO","🇨🇴 Colombia","+57"],["KM","🇰🇲 Comoros","+269"],["CG","🇨🇬 Congo","+242"],["CD","🇨🇩 DR Congo","+243"],["CK","🇨🇰 Cook Islands","+682"],["CR","🇨🇷 Costa Rica","+506"],["CI","🇨🇮 Côte d’Ivoire","+225"],["HR","🇭🇷 Croatia","+385"],["CU","🇨🇺 Cuba","+53"],["CW","🇨🇼 Curaçao","+599"],["CY","🇨🇾 Cyprus","+357"],["CZ","🇨🇿 Czechia","+420"],
["DK","🇩🇰 Denmark","+45"],["DJ","🇩🇯 Djibouti","+253"],["DM","🇩🇲 Dominica","+1767"],["DO","🇩🇴 Dominican Republic","+1809"],
["EC","🇪🇨 Ecuador","+593"],["EG","🇪🇬 Egypt","+20"],["SV","🇸🇻 El Salvador","+503"],["GQ","🇬🇶 Equatorial Guinea","+240"],["ER","🇪🇷 Eritrea","+291"],["EE","🇪🇪 Estonia","+372"],["SZ","🇸🇿 Eswatini","+268"],["ET","🇪🇹 Ethiopia","+251"],
["FK","🇫🇰 Falkland Islands","+500"],["FO","🇫🇴 Faroe Islands","+298"],["FJ","🇫🇯 Fiji","+679"],["FI","🇫🇮 Finland","+358"],["FR","🇫🇷 France","+33"],["GF","🇬🇫 French Guiana","+594"],["PF","🇵🇫 French Polynesia","+689"],
["GA","🇬🇦 Gabon","+241"],["GM","🇬🇲 Gambia","+220"],["GE","🇬🇪 Georgia","+995"],["DE","🇩🇪 Germany","+49"],["GH","🇬🇭 Ghana","+233"],["GI","🇬🇮 Gibraltar","+350"],["GR","🇬🇷 Greece","+30"],["GL","🇬🇱 Greenland","+299"],["GD","🇬🇩 Grenada","+1473"],["GP","🇬🇵 Guadeloupe","+590"],["GU","🇬🇺 Guam","+1671"],["GT","🇬🇹 Guatemala","+502"],["GG","🇬🇬 Guernsey","+44"],["GN","🇬🇳 Guinea","+224"],["GW","🇬🇼 Guinea-Bissau","+245"],["GY","🇬🇾 Guyana","+592"],
["HT","🇭🇹 Haiti","+509"],["HN","🇭🇳 Honduras","+504"],["HK","🇭🇰 Hong Kong","+852"],["HU","🇭🇺 Hungary","+36"],
["IS","🇮🇸 Iceland","+354"],["IN","🇮🇳 India","+91"],["ID","🇮🇩 Indonesia","+62"],["IR","🇮🇷 Iran","+98"],["IQ","🇮🇶 Iraq","+964"],["IE","🇮🇪 Ireland","+353"],["IM","🇮🇲 Isle of Man","+44"],["IL","🇮🇱 Israel","+972"],["IT","🇮🇹 Italy","+39"],
["JM","🇯🇲 Jamaica","+1876"],["JP","🇯🇵 Japan","+81"],["JE","🇯🇪 Jersey","+44"],
["KZ","🇰🇿 Kazakhstan","+7"],["KE","🇰🇪 Kenya","+254"],["KI","🇰🇮 Kiribati","+686"],["KP","🇰🇵 North Korea","+850"],["KR","🇰🇷 South Korea","+82"],["KW","🇰🇼 Kuwait","+965"],["KG","🇰🇬 Kyrgyzstan","+996"],
["LA","🇱🇦 Laos","+856"],["LV","🇱🇻 Latvia","+371"],["LB","🇱🇧 Lebanon","+961"],["LS","🇱🇸 Lesotho","+266"],["LR","🇱🇷 Liberia","+231"],["LY","🇱🇾 Libya","+218"],["LI","🇱🇮 Liechtenstein","+423"],["LT","🇱🇹 Lithuania","+370"],["LU","🇱🇺 Luxembourg","+352"],
["MO","🇲🇴 Macau","+853"],["MG","🇲🇬 Madagascar","+261"],["MW","🇲🇼 Malawi","+265"],["MY","🇲🇾 Malaysia","+60"],["MV","🇲🇻 Maldives","+960"],["ML","🇲🇱 Mali","+223"],["MT","🇲🇹 Malta","+356"],["MH","🇲🇭 Marshall Islands","+692"],["MQ","🇲🇶 Martinique","+596"],["MR","🇲🇷 Mauritania","+222"],["MU","🇲🇺 Mauritius","+230"],["YT","🇾🇹 Mayotte","+262"],["MX","🇲🇽 Mexico","+52"],["FM","🇫🇲 Micronesia","+691"],["MD","🇲🇩 Moldova","+373"],["MC","🇲🇨 Monaco","+377"],["MN","🇲🇳 Mongolia","+976"],["ME","🇲🇪 Montenegro","+382"],["MS","🇲🇸 Montserrat","+1664"],["MA","🇲🇦 Morocco","+212"],["MZ","🇲🇿 Mozambique","+258"],["MM","🇲🇲 Myanmar","+95"],
["NA","🇳🇦 Namibia","+264"],["NR","🇳🇷 Nauru","+674"],["NP","🇳🇵 Nepal","+977"],["NL","🇳🇱 Netherlands","+31"],["NC","🇳🇨 New Caledonia","+687"],["NZ","🇳🇿 New Zealand","+64"],["NI","🇳🇮 Nicaragua","+505"],["NE","🇳🇪 Niger","+227"],["NG","🇳🇬 Nigeria","+234"],["NU","🇳🇺 Niue","+683"],["NF","🇳🇫 Norfolk Island","+672"],["MK","🇲🇰 North Macedonia","+389"],["MP","🇲🇵 Northern Mariana Islands","+1670"],["NO","🇳🇴 Norway","+47"],
["OM","🇴🇲 Oman","+968"],
["PK","🇵🇰 Pakistan","+92"],["PW","🇵🇼 Palau","+680"],["PS","🇵🇸 Palestine","+970"],["PA","🇵🇦 Panama","+507"],["PG","🇵🇬 Papua New Guinea","+675"],["PY","🇵🇾 Paraguay","+595"],["PE","🇵🇪 Peru","+51"],["PH","🇵🇭 Philippines","+63"],["PL","🇵🇱 Poland","+48"],["PT","🇵🇹 Portugal","+351"],["PR","🇵🇷 Puerto Rico","+1787"],
["QA","🇶🇦 Qatar","+974"],
["RE","🇷🇪 Réunion","+262"],["RO","🇷🇴 Romania","+40"],["RU","🇷🇺 Russia","+7"],["RW","🇷🇼 Rwanda","+250"],
["BL","🇧🇱 Saint Barthélemy","+590"],["SH","🇸🇭 Saint Helena","+290"],["KN","🇰🇳 Saint Kitts & Nevis","+1869"],["LC","🇱🇨 Saint Lucia","+1758"],["MF","🇲🇫 Saint Martin","+590"],["PM","🇵🇲 Saint Pierre & Miquelon","+508"],["VC","🇻🇨 Saint Vincent & Grenadines","+1784"],["WS","🇼🇸 Samoa","+685"],["SM","🇸🇲 San Marino","+378"],["ST","🇸🇹 São Tomé & Príncipe","+239"],["SA","🇸🇦 Saudi Arabia","+966"],["SN","🇸🇳 Senegal","+221"],["RS","🇷🇸 Serbia","+381"],["SC","🇸🇨 Seychelles","+248"],["SL","🇸🇱 Sierra Leone","+232"],["SG","🇸🇬 Singapore","+65"],["SX","🇸🇽 Sint Maarten","+1721"],["SK","🇸🇰 Slovakia","+421"],["SI","🇸🇮 Slovenia","+386"],["SB","🇸🇧 Solomon Islands","+677"],["SO","🇸🇴 Somalia","+252"],["ZA","🇿🇦 South Africa","+27"],["SS","🇸🇸 South Sudan","+211"],["ES","🇪🇸 Spain","+34"],["LK","🇱🇰 Sri Lanka","+94"],["SD","🇸🇩 Sudan","+249"],["SR","🇸🇷 Suriname","+597"],["SE","🇸🇪 Sweden","+46"],["CH","🇨🇭 Switzerland","+41"],["SY","🇸🇾 Syria","+963"],
["TW","🇹🇼 Taiwan","+886"],["TJ","🇹🇯 Tajikistan","+992"],["TZ","🇹🇿 Tanzania","+255"],["TH","🇹🇭 Thailand","+66"],["TL","🇹🇱 Timor-Leste","+670"],["TG","🇹🇬 Togo","+228"],["TK","🇹🇰 Tokelau","+690"],["TO","🇹🇴 Tonga","+676"],["TT","🇹🇹 Trinidad & Tobago","+1868"],["TN","🇹🇳 Tunisia","+216"],["TR","🇹🇷 Turkey","+90"],["TM","🇹🇲 Turkmenistan","+993"],["TC","🇹🇨 Turks & Caicos Islands","+1649"],["TV","🇹🇻 Tuvalu","+688"],
["UG","🇺🇬 Uganda","+256"],["UA","🇺🇦 Ukraine","+380"],["AE","🇦🇪 UAE","+971"],["GB","🇬🇧 United Kingdom","+44"],["US","🇺🇸 United States","+1"],["UY","🇺🇾 Uruguay","+598"],["UZ","🇺🇿 Uzbekistan","+998"],
["VU","🇻🇺 Vanuatu","+678"],["VA","🇻🇦 Vatican City","+39"],["VE","🇻🇪 Venezuela","+58"],["VN","🇻🇳 Vietnam","+84"],["VG","🇻🇬 British Virgin Islands","+1284"],["VI","🇻🇮 U.S. Virgin Islands","+1340"],
["WF","🇼🇫 Wallis & Futuna","+681"],["YE","🇾🇪 Yemen","+967"],["ZM","🇿🇲 Zambia","+260"],["ZW","🇿🇼 Zimbabwe","+263"]
];
const PHONE_PLACEHOLDERS={
  "+962":"7X XXX XXXX","+966":"5X XXX XXXX","+971":"5X XXX XXXX","+20":"1X XXXX XXXX",
  "+970":"5X XXX XXXX","+964":"7XX XXX XXXX","+965":"5XXX XXXX","+974":"3XXX XXXX",
  "+973":"3XXX XXXX","+968":"9XXX XXXX","+961":"XX XXX XXX","+963":"9XX XXX XXX",
  "+90":"5XX XXX XXXX","+1":"(XXX) XXX-XXXX","+44":"7XXX XXXXXX","+49":"1XX XXXXXXXX",
  "+33":"X XX XX XX XX","+39":"3XX XXX XXXX","+34":"6XX XXX XXX","+31":"6 XXXXXXXX",
  "+32":"4XX XX XX XX","+46":"7X XXX XX XX","+47":"4XX XX XXX","+45":"XX XX XX XX",
  "+41":"7X XXX XX XX","+43":"6XX XXXXXXX","+30":"69X XXX XXXX","+357":"9X XXX XXX",
  "+91":"XXXXX XXXXX","+92":"3XX XXXXXXX","+880":"1XXX XXXXXX","+63":"9XX XXX XXXX",
  "+62":"8XX XXXX XXXX","+60":"1X XXXX XXXX","+65":"XXXX XXXX","+86":"1XX XXXX XXXX",
  "+81":"XX XXXX XXXX","+82":"10 XXXX XXXX","+61":"4XX XXX XXX","+64":"2X XXX XXXX",
  "+7":"9XX XXX XX XX","+380":"XX XXX XXXX","+27":"7X XXX XXXX","+212":"6XX XXX XXX",
  "+216":"XX XXX XXX","+213":"5XX XX XX XX","+218":"9X XXX XXXX","+249":"9X XXX XXXX"
};
function phonePlaceholder(code){
  return PHONE_PLACEHOLDERS[code]||"Phone number";
}
function internationalPhone(value,countryCode="+962"){
  const raw=String(value||"").trim();
  if(!raw)return "";
  if(raw.startsWith("+")) return "+"+raw.slice(1).replace(/\D/g,"");
  if(raw.startsWith("00")) return "+"+raw.slice(2).replace(/\D/g,"");
  let local=raw.replace(/\D/g,"");
  local=local.replace(/^0+/,"");
  return countryCode+local;
}
function CountryPhoneField({code,setCode,value,onChange,disabled=false,required=false,placeholder="Phone number"}){
  const[open,setOpen]=useState(false);
  const[query,setQuery]=useState("");
  const selected=COUNTRY_CODES.find(x=>x[2]===code)||COUNTRY_CODES[0];
  const q=query.trim().toLowerCase();
  const filtered=q?COUNTRY_CODES.filter(([iso,label,dial])=>label.toLowerCase().includes(q)||iso.toLowerCase().includes(q)||dial.includes(q)):COUNTRY_CODES;
  function choose(dial){setCode(dial);setOpen(false);setQuery("");}
  return <div className="country-phone-field">
    <div className="country-code-picker">
      <button type="button" className="country-code-trigger" disabled={disabled} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
        <span>{selected[1]}</span><b>{selected[2]}</b><i>⌄</i>
      </button>
      {open&&!disabled&&<div className="country-code-menu">
        <input className="country-code-search" autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search country or code..." />
        <div className="country-code-options">
          {filtered.length?filtered.map(([iso,label,dial])=><button type="button" key={iso+"-"+dial} className={dial===code?"selected":""} onClick={()=>choose(dial)}><span>{label}</span><b>{dial}</b></button>):<div className="country-code-empty">No country found</div>}
        </div>
      </div>}
    </div>
    <input inputMode="tel" value={value} onChange={onChange} disabled={disabled} required={required} placeholder={placeholder==="Phone number"||placeholder==="7X XXX XXXX"||placeholder==="Phone"?phonePlaceholder(code):placeholder}/>
  </div>;
}

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
    titleEn: raw.titleEn || "",
    titleAr: raw.titleAr || "",
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

function ApiNotice({ usingFallback, apiError }) {
  if(apiError) return <div className="api-notice api-notice--error">SeaGo can’t load live experiences right now. Please try again shortly.</div>;
  if (!usingFallback) return null;
  return <div className="api-notice">Preview mode · sample trips are shown because no live API is configured.</div>;
}

function localDateInputValue(date=new Date()) {
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function HomeScreen({ tripList, onSelectTrip, favourites, toggleFavourite, usingFallback, apiError, loading, onSearch, onOpenMenu, onSeeAll }) {
  const {t,category}=useLanguage();
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
          <p className="eyebrow">{t("home.hero.eyebrow")}</p>
          <h1>{t("home.hero.title")}</h1>
          <p>{t("home.hero.subtitle")}</p>
        </div>
        <div className="search-card">
          <label className="search-row search-row--control">
            <span className="search-row__icon"><Anchor size={18}/></span>
            <span><small>{t("home.tripType")}</small>
              <select value={tripType} onChange={e=>setTripType(e.target.value)}>
                {categories.map(c=><option key={c} value={c}>{category(c)}</option>)}
              </select>
            </span>
            <ChevronRight size={18}/>
          </label>
          <label className="search-row search-row--control">
            <span className="search-row__icon"><CalendarDays size={18}/></span>
            <span><small>{t("home.date")}</small>
              <input type="date" value={date} min={localDateInputValue()} onChange={e=>setDate(e.target.value)}/>
            </span>
            <ChevronRight size={18}/>
          </label>
          <div className="search-row search-row--control">
            <span className="search-row__icon"><UsersRound size={18}/></span>
            <span><small>{t("home.persons")}</small><strong>{guests} {guests===1?t("home.person"):t("home.persons")}</strong></span>
            <div className="guest-stepper">
              <button type="button" onClick={()=>setGuests(Math.max(1,guests-1))}>−</button>
              <button type="button" onClick={()=>setGuests(Math.min(20,guests+1))}>+</button>
            </div>
          </div>
          <button className="primary-button" onClick={submitSearch} disabled={searching||loading}>
            {(searching||loading)?<LoaderCircle className="spin" size={18}/>:<Search size={18}/>}
            {loading?t("home.loading"):searching?t("home.searching"):t("home.search")} {!loading&&<ChevronRight size={18}/>}
          </button>
        </div>
      </section>

      <ApiNotice usingFallback={usingFallback} apiError={apiError} />

      <section className="home-trust-strip" aria-label="SeaGo booking benefits">
        <div><CheckCircle2 size={16}/><span><b>{t("home.verified")}</b><small>{t("home.verifiedSub")}</small></span></div>
        <div><CheckCircle2 size={16}/><span><b>{t("home.pricing")}</b><small>{t("home.pricingSub")}</small></span></div>
        <div><Ticket size={16}/><span><b>{t("home.ticket")}</b><small>{t("home.ticketSub")}</small></span></div>
      </section>

      <section className="content-section">
        <div className="section-heading"><div><span>{t("home.curated")}</span><h2>{t("home.popular")}</h2><p>{t("home.popularSub")}</p></div><button onClick={onSeeAll}>{t("home.seeAll")} <ChevronRight size={14}/></button></div>
        {loading?<LoadingState label="Loading sea experiences..."/>:<div className="trip-strip">
          {tripList.slice(0,3).map(trip => (
            <TripCard key={trip.id} trip={trip} onSelectTrip={onSelectTrip} favourite={favourites.includes(trip.id)} toggleFavourite={toggleFavourite}/>
          ))}
        </div>}
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
        {trip.apiId&&<div className={"trip-live-status "+(trip.liveInventory?.nextDepartureAt?"available":"unavailable")}>
          {trip.liveInventory?.nextDepartureAt
            ? <><Clock size={13}/><span>Next {new Date(trip.liveInventory.nextDepartureAt).toLocaleString([],{timeZone:"Asia/Amman",weekday:"short",hour:"2-digit",minute:"2-digit"})} · {trip.liveInventory.nextAvailableSeats} seats</span></>
            : <><CalendarDays size={13}/><span>No departures available</span></>}
        </div>}
        <div className="trip-card__price"><span>From</span><strong>{trip.price} JOD</strong><small>per adult</small></div><div className="trip-card__cta">View experience <ChevronRight size={15}/></div>
      </div>
    </article>
  );
}

function TripsScreen({ tripList, onSelectTrip, favourites, toggleFavourite, loading, searchSummary, onClearSearch }) {
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
              <button onClick={()=>{setFilter("All Trips");setSort("recommended");onClearSearch?.();}}>Show all experiences</button>
            </div>}
    </div>
  );
}

function DetailScreen({ trip, onBack, favourite, toggleFavourite, onBook }) {
  const[departures,setDepartures]=useState([]);const[selectedDeparture,setSelectedDeparture]=useState(null);const[loadingDepartures,setLoadingDepartures]=useState(Boolean(trip?.apiId&&hasApi()));const[departureError,setDepartureError]=useState("");
  useEffect(()=>{let ignore=false;if(!trip?.apiId||!hasApi()){setLoadingDepartures(false);return;}setLoadingDepartures(true);listDepartures(trip.apiId).then(rows=>{if(ignore)return;const liveRows=rows.filter(d=>d.status==="scheduled"&&Number(d.availableSeats||0)>0&&new Date(d.startsAt)>new Date()).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));setDepartures(liveRows);setSelectedDeparture(liveRows[0]||null);setDepartureError("");}).catch(e=>{if(!ignore)setDepartureError(e.message)}).finally(()=>{if(!ignore)setLoadingDepartures(false)});return()=>{ignore=true}},[trip?.apiId]);
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
            <div><UsersRound/><span><small>Availability</small><b>{trip.liveInventory?.nextDepartureAt?`${trip.liveInventory.nextAvailableSeats} seats next trip`:"No live departure"}</b></span></div>
            <div><MapPin/><span><small>Departure</small><b>{trip.departureLocation?.name || "Aqaba"}</b></span></div>
          </div>
        </section>

        <section className="detail-section live-departures-section"><span className="detail-section__label">UPCOMING DEPARTURES</span>{loadingDepartures?<div className="live-departures-loading"><LoaderCircle className="spin" size={16}/> Checking live availability...</div>:departures.length?<div className="detail-departure-list">{departures.slice(0,6).map(d=><button key={d.id} className={selectedDeparture?.id===d.id?"detail-departure-option active":"detail-departure-option"} onClick={()=>setSelectedDeparture(d)}><CalendarDays size={17}/><div><b>{formatDeparture(d.startsAt)}</b><span>{d.availableSeats} seat{Number(d.availableSeats)===1?"":"s"} available</span></div><CheckCircle2 size={17}/></button>)}</div>:<div className="no-departures">{departureError?"Live availability is temporarily unavailable.":"No future departures are available yet."}</div>}</section>

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
        <button className="primary-button" disabled={Boolean(trip.apiId&&!selectedDeparture)} onClick={()=>onBook(selectedDeparture)}>{trip.apiId&&!selectedDeparture?"No departures available":"Continue with selected time"} <ChevronRight size={18}/></button>
      </div>
    </div>
  );
}

function GoogleSignInButton({role,onAuthenticated}){
  const host=useRef(null);
  const[enabled,setEnabled]=useState(null);
  const[error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false;
    let script=null;
    async function setup(){
      try{
        const cfg=await googleAuthConfig();
        if(cancelled)return;
        if(!cfg.enabled||!cfg.clientId){setEnabled(false);return;}
        setEnabled(true);
        if(!window.google?.accounts?.id){
          await new Promise((resolve,reject)=>{
            const existing=document.querySelector('script[data-seago-google]');
            if(existing){existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",reject,{once:true});return;}
            script=document.createElement("script");script.src="https://accounts.google.com/gsi/client";script.async=true;script.defer=true;script.dataset.seagoGoogle="1";script.onload=resolve;script.onerror=reject;document.head.appendChild(script);
          });
        }
        if(cancelled||!host.current)return;
        window.google.accounts.id.initialize({client_id:cfg.clientId,callback:async response=>{
          try{setError("");const result=await googleSignIn(response.credential,role);onAuthenticated(result)}catch(e){setError(e.message||"Google sign-in failed")}
        }});
        host.current.innerHTML="";
        window.google.accounts.id.renderButton(host.current,{theme:"outline",size:"large",shape:"rectangular",text:"continue_with",width:340});
      }catch(e){if(!cancelled){setEnabled(false);setError("Google sign-in is temporarily unavailable")}}
    }
    setup();
    return()=>{cancelled=true;};
  },[role,onAuthenticated]);
  return <div className="google-auth-wrap">{enabled===false?<button type="button" className="google-auth-disabled" disabled><span className="google-g">G</span> Continue with Google</button>:<div ref={host} className="google-auth-host"/>}{error&&<small className="google-auth-error">{error}</small>}</div>;
}

function AuthForm({ onAuthenticated }) {
  const [mode,setMode]=useState("login");
  const [form,setForm]=useState({name:"",email:"",phone:"",password:""});
  const [countryCode,setCountryCode]=useState("+962");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const result = mode === "login"
        ? await loginCustomer({email:form.email,password:form.password})
        : await registerCustomer({...form,phone:internationalPhone(form.phone,countryCode)});
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next){setMode(next);setError("");}

  return (
    <div className="auth-panel">
      <div className="auth-panel__head">
        <span>SEAGO ACCOUNT</span>
        <h2>{mode==="login" ? "Sign in to book" : "Create your account"}</h2>
        <p>Continue with Google or use your email and password.</p>
      </div>
      <GoogleSignInButton role="customer" onAuthenticated={onAuthenticated}/>
      <div className="auth-divider"><span>or use email</span></div>
      <form onSubmit={submit}>
        {mode==="register" && <input placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/>}
        <input type="email" placeholder="Email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required/>
        {mode==="register" && <CountryPhoneField code={countryCode} setCode={setCountryCode} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Phone (optional)"/>}
        <input type="password" minLength="8" maxLength="128" placeholder="Password (8+ characters)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required/>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button auth-submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18}/> : null}
          {mode==="login"?"Sign in":"Create account"}
        </button>
      </form>
      <button className="auth-switch" onClick={()=>switchMode(mode==="login"?"register":"login")}>
        {mode==="login" ? "New to SeaGo? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
function formatDeparture(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    timeZone:"Asia/Amman", weekday:"short", day:"numeric", month:"short", hour:"numeric", minute:"2-digit"
  }).format(date);
}

function BookingScreen({ trip, auth, onAuthenticated, onBack, initialCriteria }) {
  const [adults,setAdults]=useState(()=>Math.max(1,Number(initialCriteria?.guests||2)));
  const [children,setChildren]=useState(0);
  const [mealPlan,setMealPlan]=useState("without_buffet");
  const guests=adults+children;
  const [departures,setDepartures]=useState([]);
  const [selected,setSelected]=useState(null);
  const seatLimit=selected?.availableSeats!=null?Number(selected.availableSeats):20;
  const [quote,setQuote]=useState(null);
  const [loading,setLoading]=useState(Boolean(trip.apiId && hasApi()));
  const [error,setError]=useState("");
  const [success,setSuccess]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const checkoutAttempt=useRef({fingerprint:"",key:""});
  const [holdNow,setHoldNow]=useState(Date.now());
  const live = Boolean(trip.apiId && hasApi());

  useEffect(()=>{
    let ignore=false;
    if(!live) { setLoading(false); return; }
    setLoading(true);
    listDepartures(trip.apiId)
      .then(rows=>{
        if(ignore) return;
        const eligible=rows.filter(x=>x.status==="scheduled"&&Number(x.availableSeats||0)>0&&new Date(x.startsAt)>new Date()).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
        setDepartures(eligible);
        const wantedDepartureId=initialCriteria?.departureId || "";
        const wantedDate=initialCriteria?.date || "";
        const exact=eligible.find(x=>String(x.id)===String(wantedDepartureId)&&Number(x.availableSeats||0)>=Number(initialCriteria?.guests||1));
        const matching=eligible.find(x=>{
          const depDate=localDateInputValue(new Date(x.startsAt));
          return Number(x.availableSeats||0)>=Number(initialCriteria?.guests||1) && (!wantedDate || depDate===wantedDate);
        });
        const first=exact || matching || eligible.find(x=>Number(x.availableSeats||0)>=Number(initialCriteria?.guests||1));
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
      setError(`This departure has ${cap} seat${cap===1?"":"s"} available. Person count was adjusted.`);
    }
  },[selected?.id]);

  useEffect(()=>{
    let ignore=false;
    if(!live || !selected) { setQuote(null); return; }
    setQuote(null);
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
    if(submitting)return;
    setError("");
    if(!live) {
      setError("Live booking is unavailable for this experience.");
      return;
    }
    if(!selected) return setError("No available departure selected.");
    if(guests<1) return setError("Add at least one adult or child.");
    if(!auth?.token) return setError("AUTH_REQUIRED");
    if(!quote)return setError("Please wait for the current price before continuing.");

    const fingerprint=[selected.id,adults,children,mealPlan].join("|");
    if(checkoutAttempt.current.fingerprint!==fingerprint){
      checkoutAttempt.current={
        fingerprint,
        key:globalThis.crypto?.randomUUID?.()||`checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`
      };
    }
    setSubmitting(true);
    try {
      const payment=await createPaymentCheckout({
        departureId:selected.id,adults,children,mealPlan,token:auth.token,
        idempotencyKey:checkoutAttempt.current.key
      });
      setSuccess({
        expiresAt:payment.expiresAt,
        paymentId:payment.paymentId,
        paymentProvider:payment.provider,
        checkoutUrl:payment.checkoutUrl,
        amount:payment.amount,
        currency:payment.currency||"JOD"
      });
    } catch(err) {
      if(err.status===409) setError("This departure is no longer available for the selected persons. Please choose another departure or reduce the person count.");
      else if(err.status===401||err.status===403) setError("AUTH_REQUIRED");
      else setError(err.message || "We couldn’t start secure payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const holdRemaining=success?.expiresAt ? Math.max(0,new Date(success.expiresAt).getTime()-holdNow) : null;
  const holdExpired=holdRemaining===0;
  const holdMinutes=holdRemaining!=null?Math.floor(holdRemaining/60000):0;
  const holdSeconds=holdRemaining!=null?Math.floor((holdRemaining%60000)/1000):0;
  const total=quote?.pricing?.grossAmount ?? null;

  if(success) {
    return (
      <div className="screen standard-screen payment-handoff">
        <div className="payment-handoff__top"><BrandLogo /><span>STEP 2 OF 2</span></div>
        <div className="payment-handoff__icon"><CheckCircle2 size={34}/></div>
        <h1>{success.paymentProvider==="mock" ? "Test payment ready" : "Ready for secure payment"}</h1>
        <p>{success.paymentProvider==="mock" ? "Controlled pilot mode: this is a test payment and no real money will be charged." : "Your selected seats are temporarily protected. Complete payment to create the confirmed booking and QR ticket."}</p>
        <div className="payment-review-card">
          <div><span>Experience</span><b>{trip.title}</b></div>
          {selected?.startsAt&&<div><span>Departure</span><b>{formatDeparture(selected.startsAt)}</b></div>}
          <div><span>Persons</span><b>{adults} adult{adults===1?"":"s"}{children>0 ? " · "+children+" child"+(children===1?"":"ren") : ""}</b></div>
          <div><span>Total</span><strong>{Number(success.amount??total??0).toFixed(2)} {success.currency||"JOD"}</strong></div>
        </div>
        {success.expiresAt && <div className={"hold-box hold-box--secure "+(holdExpired?"is-expired":"")}><CheckCircle2 size={16}/><span>{holdExpired?<><b>Seat hold expired</b><small>Return to trip details to check availability again.</small></>:<>Seats reserved for <b>{String(holdMinutes).padStart(2,"0")}:{String(holdSeconds).padStart(2,"0")}</b><small>Complete payment before the timer ends.</small></>}</span></div>}
        <div className="payment-safety"><span><CheckCircle2 size={15}/> Booking created only after successful payment</span><span><CheckCircle2 size={15}/> QR ticket available immediately after confirmation</span></div>
        {!success.demo && success.checkoutUrl && <button className="primary-button payment-main-cta" disabled={holdExpired} onClick={()=>{if(!holdExpired)window.location.href=success.checkoutUrl;}}>{holdExpired?"Hold expired":"Pay securely · "+Number(success.amount??total??0).toFixed(2)+" "+(success.currency||"JOD")} {!holdExpired&&<ChevronRight size={18}/>}</button>}
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
      <div className="booking-title"><span>BOOKING · STEP 1 OF 2</span><h1>Choose your trip details</h1><p className="booking-subtitle">Review the departure, persons and package before payment.</p>{initialCriteria?.date&&<p className="booking-search-context">Your search: {new Date(initialCriteria.date+"T12:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})} · {guests} {guests===1?"person":"persons"}</p>}<div className="booking-progress"><i/><i/></div></div>
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

          <div className="booking-form booking-form--guests"><div className="booking-form__section-title">2 · PERSONS & PACKAGE</div>
            <label><span>Adults <small>13+</small></span><div className="stepper"><button type="button" onClick={()=>setAdults(Math.max(0,adults-1))} disabled={adults===0}>−</button><b>{adults}</b><button type="button" onClick={()=>setAdults(adults+1)} disabled={guests>=seatLimit}>+</button></div></label>
            <label><span>Children <small>6–12 years</small></span><div className="stepper"><button type="button" onClick={()=>setChildren(Math.max(0,children-1))} disabled={children===0}>−</button><b>{children}</b><button type="button" onClick={()=>setChildren(children+1)} disabled={guests>=seatLimit}>+</button></div></label>
            {trip.buffetEnabled&&<div className="meal-options"><span>Meal option</span><button type="button" className={mealPlan==="without_buffet"?"meal-option active":"meal-option"} onClick={()=>setMealPlan("without_buffet")}><b>Trip only</b><small>Without buffet</small></button><button type="button" className={mealPlan==="with_buffet"?"meal-option active":"meal-option"} onClick={()=>setMealPlan("with_buffet")}><b>Trip + open buffet</b><small>{trip.buffetDescription||"Buffet included"}</small></button></div>}
            <div className="booking-account-row"><span>Account</span><div><UserRound size={18}/><b>{auth?.user?.email || "Sign in during booking"}</b><CheckCircle2 size={16}/></div></div>
          </div>

          {error && error!=="AUTH_REQUIRED" && <div className="booking-error">{error}</div>}

          <div className="price-box"><div className="price-box__heading"><span>LIVE PRICE SUMMARY</span><small>Calculated by SeaGo</small></div>{quote?<>{adults>0&&<div><span>{adults} Adult{adults===1?"":"s"} × {Number(quote.pricing?.adultUnitPrice||0).toFixed(2)}</span><b>{Number(quote.pricing?.adultSubtotal||0).toFixed(2)} JOD</b></div>}{children>0&&<div><span>{children} Child{children===1?"":"ren"} (6–12) × {Number(quote.pricing?.childUnitPrice||0).toFixed(2)}</span><b>{Number(quote.pricing?.childSubtotal||0).toFixed(2)} JOD</b></div>}{trip.buffetEnabled&&<div><span>Package</span><b>{mealPlan==="with_buffet"?"Open buffet included":"Without buffet"}</b></div>}{mealPlan==="with_buffet"&&trip.buffetDescription&&<div><span>Buffet</span><b>{trip.buffetDescription}</b></div>}<div><span>Service fee</span><b>Included</b></div><hr/><div className="price-box__total"><span>Total</span><strong>{Number(total||0).toFixed(2)} JOD</strong></div></>:<div className="live-price-loading"><LoaderCircle className="spin" size={16}/><span>{selected?"Fetching current price...":"Choose a departure to see the live price"}</span></div>}</div>
          <div className="checkout-trust-row"><span><CheckCircle2 size={15}/> Secure checkout</span><span><CheckCircle2 size={15}/> Instant ticket after payment</span></div><button className="primary-button booking-confirm" onClick={confirm} disabled={submitting || (live && (!selected || !quote))}>{submitting?<><LoaderCircle className="spin" size={18}/> Starting secure payment...</>:<>Continue to secure payment <ChevronRight size={18}/></>}</button>
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

  useEffect(()=>{
    if(!hasApi()||!auth?.token)return;
    let stopped=false;
    async function refreshSilently(){
      if(document.visibilityState==="hidden")return;
      try{
        const rows=await listBookings(auth.token);
        if(!stopped)setTickets(Array.isArray(rows)?rows:[]);
      }catch{}
    }
    const timer=window.setInterval(refreshSilently,5000);
    const onFocus=()=>refreshSilently();
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onFocus);
    return()=>{
      stopped=true;
      window.clearInterval(timer);
      window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onFocus);
    };
  },[auth?.token]);

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
    const used=Boolean(b.checkedInAt);
    const visualStatus=used?"used":b.status;
    const statusLabels={pending_payment:"Awaiting payment",confirmed:"Confirmed",used:"USED",cancelled:"Cancelled",expired:"Expired",refunded:"Refunded"};
    const status=statusLabels[visualStatus]||String(visualStatus||"").replaceAll("_"," ");
    const qrValue=b.ticketToken ? `SG2:${b.ticketToken}` : (b.ticketValidationUrl || `AQABA-SEAGO|BOOKING:${b._id}|REF:${ref}`);
    return <article className={`ticket-card ticket-card--${visualStatus}`} key={b._id}>
      <div className="ticket-card__top"><div><span className="ticket-kicker">AQABA SEAGO TICKET</span><h2>{title}</h2><p>{trip.category?CATEGORY_LABELS[trip.category]||trip.category:"Sea Experience"}</p>{provider.businessName&&<p className="ticket-provider"><CheckCircle2 size={13}/> Verified operator · <strong>{provider.businessName}</strong></p>}</div><span className={`ticket-status ticket-status--${visualStatus}`}>{status}</span></div>
      {used?<div className="ticket-used-banner"><CheckCircle2 size={16}/><span><b>Ticket used</b><small>Checked in successfully{b.checkedInAt?" · "+new Date(b.checkedInAt).toLocaleString("en-GB",{timeZone:"Asia/Amman",day:"2-digit",month:"short",hour:"numeric",minute:"2-digit"}):""}</small></span></div>:b.status==="confirmed"&&<div className="ticket-ready-banner"><CheckCircle2 size={16}/><span><b>Ready for check-in</b><small>Keep this ticket open when you arrive</small></span></div>}
      <div className="ticket-card__details">
        <div style={{minWidth:0}}><small>Customer name</small><strong dir="auto" style={{overflowWrap:"anywhere"}}>{b.customer?.name || auth?.user?.name || "Not provided"}</strong></div>
        <div style={{minWidth:0}}><small>Phone number</small><strong dir="ltr" style={{overflowWrap:"anywhere"}}>{b.customer?.phone || auth?.user?.phoneNormalized || auth?.user?.phone || "Not provided"}</strong></div>
        <div><small>Date</small><strong>{starts?starts.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"TBA"}</strong></div>
        <div><small>Time</small><strong>{starts?starts.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}):"TBA"}</strong></div>
        <div><small>Persons</small><strong>{b.adults!==undefined?`${b.adults||0}A · ${b.children||0}C`:b.seats||1}</strong></div><div><small>Package</small><strong>{b.mealPlan==="with_buffet"?"With buffet":"No buffet"}</strong></div>
        <div><small>Total</small><strong>{Number(b.pricing?.grossAmount||0).toFixed(2)} {b.pricing?.currency||"JOD"}</strong></div>
      </div>
      <div className="ticket-card__location">{departureLocation.name&&<><div className="ticket-location-title"><MapPin size={16}/><span><small>Departure point</small><strong>{departureLocation.name}</strong></span></div>{departureLocation.address&&<span>{departureLocation.address}</span>}{departureMapsUrl&&<a className="ticket-map-button" href={departureMapsUrl} target="_blank" rel="noreferrer"><MapPin size={15}/> Open in Google Maps <ChevronRight size={14}/></a>}</>}</div><div className="ticket-card__footer"><div><small>Booking reference</small><strong>SG-{ref}</strong>{!used&&b.status==="confirmed"&&<span className="ticket-ref-note">Use this if you need support</span>}</div>{!used&&b.status==="confirmed"?<div className="ticket-qr"><QRCodeSVG value={qrValue} size={108} level="L" includeMargin={true}/><small>Show at check-in</small></div>:<div className={used?"ticket-used-stamp":"ticket-pending"}>{used?<><CheckCircle2 size={28}/><span>USED</span></>:<><Ticket size={24}/><span>{b.status==="pending_payment"?"Awaiting payment":"Ticket unavailable"}</span></>}</div>}</div>
    {b.cancellation?.cancelledAt&&<div className={"ticket-cancellation ticket-cancellation--"+(b.cancellation.refundStatus||"none")}>
      <b>{b.status==="refunded"||b.cancellation.refundStatus==="processed"?"Refund completed":"Booking cancelled"}</b>
      <span>{b.cancellation.refundPercentage||0}% refund · {Number(b.cancellation.refundAmount||0).toFixed(2)} {b.pricing?.currency||"JOD"}</span>
      <small>{b.cancellation.refundStatus==="pending"?"Refund is being processed.":b.cancellation.refundStatus==="processed"?"Refund marked as processed.":b.cancellation.refundStatus==="failed"?"Refund needs support review.":"No refund is due under this cancellation."}</small>
    </div>}</article>;
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

function PersonalDetailsScreen({ auth, onAuthenticated, onBack }) {
  const user=auth?.user||{};
  const [countryCode,setCountryCode]=useState("+962");
  const [phone,setPhone]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  async function submitPhone(e){
    e.preventDefault();
    if(!auth?.token)return;
    setBusy(true);setError("");setMessage("");
    try{
      const result=await saveAccountPhone(internationalPhone(phone,countryCode),auth.token);
      onAuthenticated?.(result);
      setPhone("");
      setMessage("Phone number saved.");
    }catch(e){setError(e.message||"Could not update phone number.");}
    finally{setBusy(false);}
  }

  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="ACCOUNT" title="Personal details" subtitle="Your SeaGo account information." onBack={onBack}/>
    <section className="profile-detail-card">
      <div><span className="profile-detail-icon"><UserRound size={18}/></span><span><small>Full name</small><b>{user.name||"Not provided"}</b></span></div>
      <div><span className="profile-detail-icon"><Sparkles size={18}/></span><span><small>Email</small><b>{user.email||"Not provided"}</b></span></div>
      <div><span className="profile-detail-icon"><UserRound size={18}/></span><span><small>Phone</small><b>{user.phone||"Not provided"}</b></span></div>
    </section>
    {auth?.token&&<form className="phone-update-card" onSubmit={submitPhone}>
      <div><b>{user.phone?"Change phone number":"Add a phone number"}</b><small>This number is used for booking contact and WhatsApp communication. No SMS verification is required.</small></div>
      <CountryPhoneField code={countryCode} setCode={setCountryCode} value={phone} onChange={e=>setPhone(e.target.value)} required/>
      {error&&<div className="form-error">{error}</div>}
      {message&&<div className="form-success">{message}</div>}
      <button className="primary-button" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:null}Save phone number</button>
    </form>}
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

function SupportScreen({ auth, navigate, onBack }) {
  const [subject,setSubject]=useState("Booking support");
  const [message,setMessage]=useState("");
  const [bookingId,setBookingId]=useState("");
  const [tickets,setTickets]=useState([]);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");

  useEffect(()=>{
    let ignore=false;
    if(!auth?.token||!hasApi())return;
    listBookings(auth.token).then(rows=>{if(!ignore)setTickets(Array.isArray(rows)?rows:[])}).catch(()=>{});
    return()=>{ignore=true;};
  },[auth?.token]);

  async function submit(e){
    e.preventDefault();
    if(!auth?.token)return setError("Sign in first to contact SeaGo support.");
    setBusy(true);setError("");setStatus("");
    try{
      const result=await createSupportRequest({subject,message,bookingId:bookingId||undefined},auth.token);
      setMessage("");
      setStatus(`Support request sent${result.bookingReference?" · "+result.bookingReference:""}.`);
    }catch(e){setError(e.message||"Could not send support request.");}
    finally{setBusy(false);}
  }

  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="HELP & SUPPORT" title="How can we help?" subtitle="Send a tracked support request to SeaGo." onBack={onBack}/>
    <section className="support-highlight">
      <Ticket size={24}/><div><h2>Need help with a booking?</h2><p>Choose the booking below so SeaGo receives the correct reference automatically.</p></div>
      <button onClick={()=>navigate("tickets")}>My tickets <ChevronRight size={16}/></button>
    </section>
    {auth?.token?<form className="support-request-card" onSubmit={submit}>
      <label><span>Booking</span><select value={bookingId} onChange={e=>setBookingId(e.target.value)}><option value="">General support</option>{tickets.map(b=><option key={b._id} value={b._id}>SG-{String(b._id).slice(-8).toUpperCase()} · {b.tripId?.titleEn||b.tripId?.titleAr||"SeaGo trip"}</option>)}</select></label>
      <label><span>Subject</span><input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={120} required/></label>
      <label><span>Message</span><textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={2000} rows={5} placeholder="Tell us what you need help with…" required/></label>
      {error&&<div className="form-error">{error}</div>}
      {status&&<div className="form-success">{status}</div>}
      <button className="primary-button" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:null}Send support request</button>
    </form>:<div className="support-signin-note">Sign in to send a tracked support request.</div>}
    <div className="support-faq">
      <details><summary>Where is my departure point?</summary><p>Open your ticket to see the departure location and the Google Maps shortcut when provided by the operator.</p></details>
      <details><summary>When do I receive my QR ticket?</summary><p>Your QR ticket becomes available after successful payment and confirmed booking creation.</p></details>
      <details><summary>What if I need to cancel?</summary><p>Send a support request linked to the booking. Refund eligibility depends on the cancellation policy.</p></details>
    </div>
  </div>;
}

function PoliciesScreen({ onBack, navigate }) {
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
      <span>LEGAL & PRIVACY</span>
      <h2>Review the platform terms</h2>
      <p>See how SeaGo handles account data, bookings, payments and platform responsibilities.</p>
      <div className="policy-link-list">
        <button onClick={()=>navigate("privacy")}><span><b>Privacy notice</b><small>Account, booking and notification data</small></span><ChevronRight size={17}/></button>
        <button onClick={()=>navigate("terms")}><span><b>Terms of use</b><small>Booking and platform conditions</small></span><ChevronRight size={17}/></button>
      </div>
    </section>
  </div>;
}

function PrivacyScreen({ onBack }) {
  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="LEGAL" title="Privacy notice" subtitle="How SeaGo uses information needed to provide the service." onBack={onBack}/>
    <section className="policy-page-card legal-copy">
      <span>INFORMATION WE USE</span>
      <h2>Data connected to your SeaGo account</h2>
      <p>SeaGo may process the account details you provide, booking and payment references, saved trips, notification preferences, and operational records needed to support your bookings.</p>
    </section>
    <section className="policy-page-card legal-copy">
      <span>WHY IT IS USED</span>
      <h2>Booking, support and trip communication</h2>
      <p>Information is used to create and manage bookings, issue tickets, communicate important trip changes, support cancellations and refunds, prevent misuse, and operate the platform.</p>
    </section>
    <section className="policy-page-card legal-copy">
      <span>SERVICE PARTNERS</span>
      <h2>Operators and payment services</h2>
      <p>Information necessary to fulfil a booking may be shared with the relevant trip operator and payment or infrastructure providers used to deliver the service.</p>
    </section>
    <section className="policy-page-card legal-copy">
      <span>BEFORE PUBLIC LAUNCH</span>
      <h2>Final legal review required</h2>
      <p>This in-app notice describes the current product behaviour. The production privacy policy should be reviewed against the final company, payment provider, hosting setup and applicable Jordanian requirements before public launch.</p>
    </section>
  </div>;
}

function TermsScreen({ onBack }) {
  return <div className="screen standard-screen profile-sub-screen">
    <ProfileSubHeader eyebrow="LEGAL" title="Terms of use" subtitle="Core conditions for using Aqaba SeaGo." onBack={onBack}/>
    <section className="policy-page-card legal-copy">
      <span>BOOKINGS</span>
      <h2>A booking is confirmed after successful payment</h2>
      <p>A selected departure is not a confirmed booking until payment has been verified and SeaGo has issued the booking record and ticket.</p>
    </section>
    <section className="policy-page-card legal-copy">
      <span>OPERATORS</span>
      <h2>Experiences are delivered by participating providers</h2>
      <p>Trip descriptions, schedules, meeting points and operational details are provided for the booked experience. Provider-side changes may require customer notification, rescheduling, cancellation or refund handling.</p>
    </section>
    <section className="policy-page-card legal-copy">
      <span>CANCELLATIONS</span>
      <h2>The displayed cancellation policy applies</h2>
      <p>The current customer policy shown before booking is 100% refund at least 24 hours before departure, 50% from 12 to 24 hours, and no refund with less than 12 hours. Operator cancellation is handled separately under the platform policy.</p>
    </section>
    <section className="policy-page-card legal-copy">
      <span>BEFORE PUBLIC LAUNCH</span>
      <h2>Final legal review required</h2>
      <p>These terms reflect the current product flow and are not a substitute for final production terms reviewed for the operating entity, provider agreements, payment gateway and applicable Jordanian law.</p>
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
  const pending=["pending","processing","success","created"].includes(status)&&!confirmed;
  const failed=["failed","cancelled","expired"].includes(status);
  const review=status==="needs_review";

  useEffect(()=>{
    if(!pending||!paymentId||!auth?.token)return;
    let attempts=0;
    const timer=setInterval(()=>{
      attempts+=1;
      verify();
      if(attempts>=10)clearInterval(timer);
    },2000);
    return()=>clearInterval(timer);
  },[pending,paymentId,auth?.token]);

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
          <div className="notification-card__copy"><div className="notification-card__top"><b>{n.title}</b>{!n.readAt&&<span className="notification-new">NEW</span>}</div><p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString("en-GB",{timeZone:"Asia/Amman",day:"2-digit",month:"short",hour:"numeric",minute:"2-digit"})}</small></div>
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
  const [active,setActive]=useState(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.get("open")==="notifications") return "notifications";
    if(params.get("payment")) return "home";
    const saved=sessionStorage.getItem("seago_active_screen");
    return ["home","trips","tickets","favourites","notifications","profile"].includes(saved)?saved:"home";
  });
  const [detail,setDetail]=useState(null);
  const [booking,setBooking]=useState(false);
  const [tripList,setTripList]=useState(()=>hasApi()?[]:fallbackTrips);
  const [loadingTrips,setLoadingTrips]=useState(hasApi());
  const [usingFallback,setUsingFallback]=useState(!hasApi());
  const [tripLoadError,setTripLoadError]=useState("");
  const [searchResults,setSearchResults]=useState(null);
  const [searchSummary,setSearchSummary]=useState("");
  const [searchCriteria,setSearchCriteria]=useState(null);
  const [paymentReturn,setPaymentReturn]=useState(()=>Boolean(new URLSearchParams(window.location.search).get("payment")));
  const [favourites,setFavourites]=useState(()=>{try{return JSON.parse(localStorage.getItem("seago_favourites")||"[\"snorkel-coral\"]")}catch{return ["snorkel-coral"]}});
  const [auth,setAuth]=useState(readStoredAuth());
  const [menuOpen,setMenuOpen]=useState(false);
  const [alertsUnread,setAlertsUnread]=useState(0);
  const historyReady=useRef(false);
  const restoringHistory=useRef(false);

  useEffect(()=>{
    const expired=()=>{
      setAuth(null);
      setAlertsUnread(0);
      setBooking(false);
      setDetail(null);
      setActive("profile");
    };
    window.addEventListener("seago:session-expired",expired);
    return()=>window.removeEventListener("seago:session-expired",expired);
  },[]);

  useEffect(()=>{
    function restore(event){
      const nav=event.state?.seago;
      if(!nav) return;
      restoringHistory.current=true;
      setMenuOpen(false);
      setActive(nav.active||"home");
      setDetail(nav.detail||null);
      setBooking(Boolean(nav.booking&&nav.detail));
      window.setTimeout(()=>{restoringHistory.current=false;},0);
    }
    window.addEventListener("popstate",restore);
    return()=>window.removeEventListener("popstate",restore);
  },[]);

  useEffect(()=>{
    if(paymentReturn) return;
    const snapshot={seago:{active,detail,booking:Boolean(booking&&detail)}};
    if(!historyReady.current){
      window.history.replaceState(snapshot,"",window.location.href);
      historyReady.current=true;
      return;
    }
    if(restoringHistory.current) return;
    window.history.pushState(snapshot,"",window.location.href);
  },[active,detail?.id,booking,paymentReturn]);

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
      .then(async rows=>{
        if(ignore) return;
        const normalized=rows.map(normalizeTrip);
        const enriched=await Promise.all(normalized.map(async trip=>{
          try{
            const deps=await listDepartures(trip.apiId);
            const available=deps.filter(d=>d.status==="scheduled"&&Number(d.availableSeats||0)>0&&new Date(d.startsAt)>new Date()).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
            const next=available[0]||null;
            return {...trip,liveInventory:{
              upcomingCount:available.length,
              nextDepartureAt:next?.startsAt||null,
              nextAvailableSeats:next?Number(next.availableSeats||0):0,
              totalAvailableSeats:available.reduce((s,d)=>s+Number(d.availableSeats||0),0)
            }};
          }catch{return {...trip,liveInventory:{upcomingCount:0,nextDepartureAt:null,nextAvailableSeats:0,totalAvailableSeats:0}}}
        }));
        if(ignore) return;
        setTripList(enriched);
        setUsingFallback(false);
        setTripLoadError("");
      })
      .catch(()=>{
        if(!ignore){
          if(hasApi()){setTripList([]);setUsingFallback(false);setTripLoadError("LIVE_TRIPS_UNAVAILABLE");}
          else {setTripList(fallbackTrips);setUsingFallback(true);}
        }
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
            const live = d.status==="scheduled" && new Date(d.startsAt)>new Date();
            const enoughSeats = Number(d.availableSeats||0) >= Number(guests||1);
            if (!live || !enoughSeats) return false;
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
    const parts=[tripType!=="All Trips"?tripType:null,date?new Date(date+"T12:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"}):null,guests?guests+" persons":null].filter(Boolean);
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
    setAlertsUnread(0);
    localStorage.removeItem("seago_auth");
  }

  useEffect(()=>{
    window.scrollTo(0,0);
  },[active,detail?.id,booking,paymentReturn]);

  useEffect(()=>{
    if(["home","trips","tickets","favourites","notifications","profile"].includes(active)){
      sessionStorage.setItem("seago_active_screen",active);
    }
  },[active]);

  const toggleFavourite=id=>setFavourites(x=>{const next=x.includes(id)?x.filter(v=>v!==id):[...x,id];localStorage.setItem("seago_favourites",JSON.stringify(next));return next;});
  const openTrip=trip=>{setDetail(trip);setBooking(false);};

  if(paymentReturn) return <PaymentReturnScreen auth={auth} onViewTicket={viewPaidTicket} onReturnHome={()=>{setPaymentReturn(false);setActive("home");const url=new URL(window.location.href);url.searchParams.delete("payment");url.searchParams.delete("paymentId");window.history.replaceState({},"",url.pathname+(url.search?url.search:""));}}/>;
  if(booking&&detail) return <BookingScreen trip={detail} auth={auth} onAuthenticated={saveAuth} onBack={()=>setBooking(false)} initialCriteria={searchCriteria}/>;
  if(detail) return <DetailScreen trip={detail} onBack={()=>setDetail(null)} favourite={favourites.includes(detail.id)} toggleFavourite={toggleFavourite} onBook={dep=>{if(dep)setSearchCriteria(v=>({...v,departureId:dep.id,date:localDateInputValue(new Date(dep.startsAt))}));setBooking(true)}}/>;

  return <div className="app-shell">
    <main>
      {active==="home"&&<HomeScreen loading={loadingTrips} tripList={tripList} onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite} usingFallback={usingFallback} apiError={tripLoadError} onSearch={runHomeSearch} onOpenMenu={()=>setMenuOpen(true)} onSeeAll={()=>{setSearchResults(null);setSearchSummary("");setActive("trips");}}/>}
      {active==="trips"&&<TripsScreen tripList={searchResults??tripList} onSelectTrip={openTrip} favourites={favourites} toggleFavourite={toggleFavourite} loading={loadingTrips} searchSummary={searchSummary} onClearSearch={()=>{setSearchResults(null);setSearchSummary("");setSearchCriteria(null);}}/>}
      {active==="tickets"&&<TicketsScreen auth={auth} onAuthenticated={saveAuth}/>}
      {active==="favourites"&&<FavouritesScreen favourites={favourites} tripList={tripList} onSelectTrip={openTrip} toggleFavourite={toggleFavourite}/>}
      {active==="notifications"&&<NotificationsScreen auth={auth} onUnreadChange={setAlertsUnread} onAuthenticated={saveAuth}/>}
      {active==="profile"&&<ProfileScreen auth={auth} onAuthenticated={saveAuth} onSignOut={signOut} navigate={setActive}/>}
      {active==="personal-details"&&<PersonalDetailsScreen auth={auth} onAuthenticated={saveAuth} onBack={()=>setActive("profile")}/>}
      {active==="trip-preferences"&&<TripPreferencesScreen favourites={favourites} navigate={setActive} onBack={()=>setActive("profile")}/>}
      {active==="support"&&<SupportScreen auth={auth} navigate={setActive} onBack={()=>setActive("profile")}/>}
      {active==="policies"&&<PoliciesScreen onBack={()=>setActive("profile")} navigate={setActive}/>} 
      {active==="privacy"&&<PrivacyScreen onBack={()=>setActive("policies")}/>} 
      {active==="terms"&&<TermsScreen onBack={()=>setActive("policies")}/>}
    </main>
    <SideMenu open={menuOpen} onClose={()=>setMenuOpen(false)} active={active} setActive={setActive}/>
    <BottomNav active={["personal-details","trip-preferences","support","policies","privacy","terms"].includes(active)?"profile":active} setActive={setActive} unread={alertsUnread}/>
  </div>;
}
