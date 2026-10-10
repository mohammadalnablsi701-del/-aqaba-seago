import React,{useEffect,useRef,useState}from"react";
import{Bell,CalendarDays,CheckCircle2,Clock,Flashlight,Home,LogOut,MapPin,Pencil,Plus,QrCode,RefreshCw,Settings,ShipWheel,Ticket,UsersRound,XCircle}from"lucide-react";
import{Html5Qrcode}from"html5-qrcode";
import{login,registerProvider,me,createProviderProfile,updateProviderSettings,trips,departures,bookings,checkIn,inspectTicket,createTrip,updateTrip,createDeparture,createDeparturesBulk,updateDeparture,bookingDetail,manualCheckInBooking,departureManifest,uploadTripImage,deleteTripImage,listNotifications,markNotificationRead,markAllNotificationsRead,enablePushNotifications,pushNotificationStatus,sendTestPush,providerTeam,createProviderTeamMember,updateProviderTeamMember,providerAuditLog,googleAuthConfig,googleSignIn}from"./api.js";
import{buildTripFormState,serializeTripForm}from"./tripFormModel.js";

function whatsappNumber(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  const digits=raw.replace(/\D/g,"");
  if(/^07\d{8}$/.test(digits)) return "962"+digits.slice(1);
  if(/^7\d{8}$/.test(digits)) return "962"+digits;
  if(/^00962\d+$/.test(digits)) return digits.slice(2);
  if(/^962\d+$/.test(digits)) return digits;
  return digits;
}

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
  let local=raw.replace(/\D/g,"").replace(/^0+/,"");
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
const CATEGORIES=["group_boat","private_boat","yacht","glass_bottom","snorkeling","diving","fishing","sunset","private_event","water_sports","semi_submarine"];
const TRIP_TEMPLATES=[
  {id:"snorkeling",label:"Snorkeling",category:"snorkeling",durationMinutes:180,adultPrice:20,childPrice:14},
  {id:"glass",label:"Glass Bottom",category:"glass_bottom",durationMinutes:90,adultPrice:15,childPrice:10},
  {id:"yacht",label:"Yacht Cruise",category:"yacht",durationMinutes:120,adultPrice:25,childPrice:18},
  {id:"sunset",label:"Sunset",category:"sunset",durationMinutes:120,adultPrice:25,childPrice:18},
  {id:"group",label:"Group Boat",category:"group_boat",durationMinutes:120,adultPrice:18,childPrice:12},
  {id:"private",label:"Private Boat",category:"private_boat",durationMinutes:120,adultPrice:60,childPrice:0}
];
function ProviderBrand(){return <div className="brand provider-brand"><svg className="provider-brand-mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#C6A46A" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="10.5"/>{[0,45,90,135,180,225,270,315].map(a=><line key={a} x1="32" y1="5.5" x2="32" y2="14" transform={`rotate(${a} 32 32)`}/>)}<path d="M25 33c3-4 6 3 9 2 2-.5 3.5-2 5-3"/></g></svg><div className="provider-brand-copy"><b>SeaGo</b><span>AQABA · PROVIDER</span></div></div>}
function today(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Amman",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function authStore(){try{return JSON.parse(localStorage.getItem("seago_provider_auth")||"null")}catch{return null}}
function mediaUrl(x){return typeof x==="string"?x:(x?.url||"")}
function mediaObj(x){return typeof x==="string"?{url:x,source:"external"}:x}
function sameMedia(a,b){return mediaUrl(a)===mediaUrl(b)}
function providerDefaultsKey(providerId){return "seago_provider_defaults_"+String(providerId||"default")}
function loadProviderDefaults(providerId){try{return JSON.parse(localStorage.getItem(providerDefaultsKey(providerId))||"null")||{}}catch{return{}}}
function saveProviderDefaults(providerId,values){localStorage.setItem(providerDefaultsKey(providerId),JSON.stringify(values))}
function accountDefaults(provider){
  const local=loadProviderDefaults(provider?._id);
  if(!provider?.settings?.configured)return local;
  return {...local,
    capacity:provider.settings.defaultCapacity,
    lastDepartureTime:provider.settings.defaultDepartureTime,
    locationName:provider.settings.departureLocation?.name||"",
    address:provider.settings.departureLocation?.address||"",
    googleMapsUrl:provider.settings.departureLocation?.googleMapsUrl||""
  };
}
function dateOnly(d){const x=new Date(d);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")}
function tomorrowLocal(hour){const d=new Date();d.setDate(d.getDate()+1);return dateOnly(d)+"T"+(hour||"09:00")}
function resizeTripImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Could not read image"));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error("Invalid image"));img.onload=()=>{const max=1100;const scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);let q=.78;let data=canvas.toDataURL("image/jpeg",q);while(data.length>180000&&q>.4){q-=.08;data=canvas.toDataURL("image/jpeg",q)}resolve(data)};img.src=reader.result};reader.readAsDataURL(file)})}

function GoogleSignInButton({role,onDone}){
  const host=useRef(null);
  const[enabled,setEnabled]=useState(null);
  const[error,setError]=useState("");

  useEffect(()=>{
    let cancelled=false;

    async function ensureGoogleScript(){
      if(window.google?.accounts?.id)return;
      const existing=document.querySelector('script[data-seago-google]');
      if(existing){
        await new Promise((resolve,reject)=>{
          if(window.google?.accounts?.id)return resolve();
          existing.addEventListener("load",resolve,{once:true});
          existing.addEventListener("error",reject,{once:true});
        });
        return;
      }
      await new Promise((resolve,reject)=>{
        const script=document.createElement("script");
        script.src="https://accounts.google.com/gsi/client";
        script.async=true;
        script.defer=true;
        script.dataset.seagoGoogle="1";
        script.onload=resolve;
        script.onerror=reject;
        document.head.appendChild(script);
      });
    }

    async function setup(){
      try{
        const cfg=await googleAuthConfig();
        if(cancelled)return;
        if(!cfg.enabled||!cfg.clientId){
          setEnabled(false);
          return;
        }
        setEnabled(true);
        await ensureGoogleScript();
        if(cancelled||!host.current)return;

        window.google.accounts.id.initialize({
          client_id:cfg.clientId,
          callback:async response=>{
            try{
              setError("");
              const result=await googleSignIn(response.credential,role);
              if(result.user?.role!==role)throw new Error("Provider account required");
              localStorage.setItem("seago_provider_auth",JSON.stringify(result));
              onDone(result);
            }catch(e){
              setError(e.message||"Google sign-in failed");
            }
          }
        });

        host.current.innerHTML="";
        window.google.accounts.id.renderButton(host.current,{
          theme:"outline",
          size:"large",
          shape:"rectangular",
          text:"continue_with",
          width:340
        });
      }catch{
        if(!cancelled){
          setEnabled(false);
          setError("Google sign-in is temporarily unavailable");
        }
      }
    }

    setup();
    return()=>{cancelled=true;};
  },[role,onDone]);

  return <div className="google-auth-wrap">
    {enabled===false
      ?<button type="button" className="google-auth-disabled" disabled><span className="google-g">G</span> Continue with Google</button>
      :<div ref={host} className="google-auth-host"/>
    }
    {error&&<small className="google-auth-error">{error}</small>}
  </div>;
}

function Login({onDone}){const[mode,setMode]=useState("signin");const[name,setName]=useState("");const[email,setEmail]=useState("");const[phone,setPhone]=useState("");const[countryCode,setCountryCode]=useState("+962");const[password,setPassword]=useState("");const[error,setError]=useState("");const[busy,setBusy]=useState(false);
async function submit(e){e.preventDefault();setBusy(true);setError("");try{const cleanEmail=String(email||"").trim().replace(/^mailto:/i,"");const r=mode==="signup"?await registerProvider({name,email:cleanEmail,phone:internationalPhone(phone,countryCode),password}):await login(cleanEmail,password);if(r.user?.role!=="provider")throw new Error("Provider account required");localStorage.setItem("seago_provider_auth",JSON.stringify(r));onDone(r)}catch(e){setError(e.message)}finally{setBusy(false)}}
return <div className="login"><ProviderBrand/><form onSubmit={submit}><h1>{mode==="signup"?"Become a SeaGo provider":"Provider sign in"}</h1><p>{mode==="signup"?"Create your provider account, then submit your business for approval.":"Manage trips, departures and customer check-in."}</p>
<GoogleSignInButton role="provider" onDone={onDone}/><div className="auth-divider"><span>or use email</span></div>
{mode==="signup"&&<><input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} required/><CountryPhoneField code={countryCode} setCode={setCountryCode} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (optional)"/></>}
<input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value.replace(/^mailto:/i,""))} required/><input type="password" minLength="8" placeholder="Password (8+ characters)" value={password} onChange={e=>setPassword(e.target.value)} required/>
{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?"Please wait...":mode==="signup"?"Create provider account":"Sign in"}</button><button type="button" className="auth-switch" onClick={()=>{setMode(mode==="signup"?"signin":"signup");setError("")}}>{mode==="signup"?"Already have an account? Sign in":"New provider? Create an account"}</button></form></div>}
function ProviderProfileSetup({token,onCreated}){const[businessName,setBusinessName]=useState("");const[phone,setPhone]=useState("");const[countryCode,setCountryCode]=useState("+962");const[busy,setBusy]=useState(false);const[error,setError]=useState("");async function submit(e){e.preventDefault();setBusy(true);setError("");try{const p=await createProviderProfile(token,{businessName,phone:internationalPhone(phone,countryCode)});onCreated(p)}catch(e){setError(e.message)}finally{setBusy(false)}}return <div className="onboarding-shell"><div className="onboarding-card"><small>STEP 2 OF 2</small><h1>Set up your business</h1><p>Enter the business customers will see on Aqaba SeaGo. Admin approval is required before trips can be published.</p><form onSubmit={submit}><label>Business name<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Example: Aqaba Marine Tours" required/></label><label>Business phone<CountryPhoneField code={countryCode} setCode={setCountryCode} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="7X XXX XXXX"/></label>{error&&<div className="error">{error}</div>}<button className="save-button" disabled={busy}>{busy?"Submitting...":"Submit for approval"}</button></form></div></div>}

function ProviderApprovalStatus({provider,onRefresh,onSignOut}){const status=provider?.status||"pending";const copy=status==="pending"?"Your provider profile was submitted successfully. SeaGo admin approval is required before you can create trips and departures.":status==="rejected"?"Your provider application is currently rejected. Contact SeaGo support before resubmitting.":"Your provider account is suspended. Contact SeaGo support for assistance.";return <div className="onboarding-shell"><div className={"onboarding-card status-"+status}><small>{status.toUpperCase()}</small><h1>{provider?.businessName||"Provider application"}</h1><p>{copy}</p><div className="onboarding-actions"><button onClick={onRefresh}>Check approval status</button><button className="secondary" onClick={onSignOut}>Sign out</button></div></div></div>}

function scanFeedback(kind="scan"){
  try{
    if(navigator.vibrate) navigator.vibrate(kind==="success"?[80,45,120]:80);
  }catch{}
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    const ctx=new AudioCtx();
    const tones=kind==="success"?[{f:880,t:0,d:.08},{f:1175,t:.11,d:.12}]:[{f:960,t:0,d:.09}];
    if(ctx.state==="suspended")ctx.resume().catch(()=>{});
    const now=ctx.currentTime;
    tones.forEach(({f,t,d})=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type="sine";osc.frequency.value=f;
      gain.gain.setValueAtTime(.0001,now+t);
      gain.gain.exponentialRampToValueAtTime(.16,now+t+.01);
      gain.gain.exponentialRampToValueAtTime(.0001,now+t+d);
      osc.connect(gain);gain.connect(ctx.destination);
      osc.start(now+t);osc.stop(now+t+d+.02);
    });
    setTimeout(()=>ctx.close().catch(()=>{}),500);
  }catch{}
}

function Scanner({token,onClose,onDone}){
const[result,setResult]=useState(null);
const[pendingToken,setPendingToken]=useState("");
const[busy,setBusy]=useState(false);
const[scanCycle,setScanCycle]=useState(0);
const[cameraError,setCameraError]=useState("");
const[torchSupported,setTorchSupported]=useState(false);
const[torchOn,setTorchOn]=useState(false);
const[closing,setClosing]=useState(false);
const qrRef=useRef(null);
const activeRef=useRef(true);

function scanAgain(){
  setResult(null);setPendingToken("");setBusy(false);setCameraError("");setTorchOn(false);setScanCycle(x=>x+1);
}

useEffect(()=>{
  activeRef.current=true;
  if(result)return;
  const scanner=new Html5Qrcode("reader",{verbose:false});
  qrRef.current=scanner;
  let stopped=false;

  async function boot(){
    setCameraError("");
    try{
      await scanner.start(
        {facingMode:{exact:"environment"}},
        {fps:18,qrbox:(w,h)=>{const side=Math.floor(Math.min(w,h)*0.72);return{width:side,height:side}},aspectRatio:1.0,disableFlip:true},
        async decoded=>{
          if(!activeRef.current||busy||result)return;
          activeRef.current=false;
          setBusy(true);
          try{
            const raw=String(decoded||"").trim();
            if(raw.startsWith("AQABA-SEAGO|BOOKING:"))throw new Error("Old ticket QR. Refresh the customer ticket page and scan the new secure QR.");
            let t="";
            if(raw.startsWith("SG2:"))t=raw.slice(4);
            else{const u=new URL(raw);t=u.searchParams.get("token")||"";}
            if(!t)throw new Error("Invalid SeaGo QR");
            const info=await inspectTicket(token,t);
            scanFeedback("scan");
            setPendingToken(t);
            setResult({mode:"preview",...info});
            try{await scanner.stop()}catch{}
          }catch(e){
            setResult({mode:"error",error:e.message});
            try{await scanner.stop()}catch{}
          }finally{setBusy(false);}
        },
        ()=>{}
      );
      if(stopped)return;
      try{
        const caps=scanner.getRunningTrackCapabilities?.();
        setTorchSupported(Boolean(caps&&"torch" in caps&&caps.torch));
      }catch{setTorchSupported(false);}
    }catch(firstError){
      try{
        await scanner.start(
          {facingMode:"environment"},
          {fps:18,qrbox:(w,h)=>{const side=Math.floor(Math.min(w,h)*0.72);return{width:side,height:side}},aspectRatio:1.0,disableFlip:true},
          async decoded=>{
            if(!activeRef.current||busy||result)return;
            activeRef.current=false;setBusy(true);
            try{
              const raw=String(decoded||"").trim();
              let t="";
              if(raw.startsWith("SG2:"))t=raw.slice(4);
              else if(raw.startsWith("AQABA-SEAGO|BOOKING:"))throw new Error("Old ticket QR. Refresh the customer ticket page and scan the new secure QR.");
              else{const u=new URL(raw);t=u.searchParams.get("token")||"";}
              if(!t)throw new Error("Invalid SeaGo QR");
              const info=await inspectTicket(token,t);
              scanFeedback("scan");
              setPendingToken(t);setResult({mode:"preview",...info});
              try{await scanner.stop()}catch{}
            }catch(e){setResult({mode:"error",error:e.message});try{await scanner.stop()}catch{}}
            finally{setBusy(false);}
          },
          ()=>{}
        );
        try{
          const caps=scanner.getRunningTrackCapabilities?.();
          setTorchSupported(Boolean(caps&&"torch" in caps&&caps.torch));
        }catch{setTorchSupported(false);}
      }catch(e){
        setCameraError("Could not open the rear camera. Check camera permission and try again.");
      }
    }
  }

  boot();
  return()=>{
    stopped=true;
    activeRef.current=false;
    const q=qrRef.current;
    qrRef.current=null;
    if(q?.isScanning){Promise.resolve(q.stop()).catch(()=>{})}
  };
},[scanCycle,result,token]);

async function closeScanner(){
  if(closing)return;
  setClosing(true);
  activeRef.current=false;
  const scanner=qrRef.current;
  try{
    if(scanner&&torchOn&&torchSupported){
      try{await scanner.applyVideoConstraints({advanced:[{torch:false}]});}catch{}
    }
    if(scanner?.isScanning){
      try{await scanner.stop();}catch{}
    }
    if(scanner){
      try{await scanner.clear();}catch{}
    }
  }finally{
    qrRef.current=null;
    onClose();
  }
}

async function toggleTorch(){
  const scanner=qrRef.current;
  if(!scanner||!torchSupported)return;
  const next=!torchOn;
  try{
    await scanner.applyVideoConstraints({advanced:[{torch:next}]});
    setTorchOn(next);
  }catch{
    setTorchSupported(false);
  }
}

async function confirm(){
  if(!pendingToken||busy)return;
  setBusy(true);
  try{const r=await checkIn(token,pendingToken);scanFeedback("success");setResult({mode:"success",...r});onDone?.();}
  catch(e){setResult({mode:"error",error:e.message});}
  finally{setBusy(false);}
}

const mode=result?.mode;
return <div className="scanner-screen">
  <div className="scanner-head">
    <div><small>REAR CAMERA</small><h2>Scan ticket</h2></div>
    <div className="scanner-head-actions">
      {torchSupported&&!result&&<button className={"torch-button "+(torchOn?"active":"")} onClick={toggleTorch} aria-label="Toggle flash"><Flashlight size={19}/></button>}
      <button onClick={closeScanner} disabled={closing} aria-label="Close scanner">{closing?"…":"×"}</button>
    </div>
  </div>
  {!result&&<>
    <div className="scanner-stage">
      <div id="reader"></div>
      <div className="scanner-guide" aria-hidden="true"><i/><i/><i/><i/></div>
      <div className="scanner-status">{cameraError?cameraError:busy?"Reading ticket...":"Point the rear camera at the SeaGo QR"}</div>
    </div>
    {cameraError&&<button className="scanner-retry" onClick={scanAgain}>Try camera again</button>}
  </>}
  {mode==="preview"&&<div className="ticket-preview">{result.valid?<CheckCircle2 size={52}/>:<XCircle size={52}/>}<small>{result.valid?"VALID TICKET":result.used?"ALREADY USED":result.status==="cancelled"?"CANCELLED TICKET":"TICKET NOT VALID"}</small><h2>{result.trip}</h2><div className="preview-grid"><div><span>Guest</span><b>{result.customer?.name||"Guest"}</b></div><div><span>Booking</span><b>{result.bookingReference}</b></div><div><span>Persons</span><b>{result.adults!==undefined?`${result.adults||0} adult(s) · ${result.children||0} child(ren)`:result.guests}</b></div><div><span>Package</span><b>{result.mealPlan==="with_buffet"?"Open buffet":"Without buffet"}</b></div><div><span>Departure</span><b>{result.departureAt?new Date(result.departureAt).toLocaleString([],{timeZone:"Asia/Amman",dateStyle:"medium",timeStyle:"short"}):"TBA"}</b></div></div>{result.customer?.phone&&<p className="contact">{result.customer.phone}</p>}<button className="confirm-checkin" disabled={!result.valid||busy} onClick={confirm}>{busy?"Checking in...":result.used?"Already checked in":"Confirm check-in"}</button><button className="secondary-scan" onClick={scanAgain}>Cancel / scan another</button></div>}
  {mode==="success"&&<div className="scan-result ok"><CheckCircle2 size={56}/><h2>Check-in successful</h2><p>{result.guests} person(s) checked in</p><button onClick={scanAgain}>Scan another</button></div>}
  {mode==="error"&&<div className="scan-result bad"><XCircle size={56}/><h2>Ticket rejected</h2><p>{result.error}</p><button onClick={scanAgain}>Scan another</button></div>}
</div>}

function TripForm({token,trip,duplicateFrom,provider,onSaved,onCreated,onCancel}){const providerId=provider?._id;const source=trip||duplicateFrom;const defaults=accountDefaults(provider);const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[showMore,setShowMore]=useState(Boolean(trip||duplicateFrom));const[selectedTemplate,setSelectedTemplate]=useState("");const[form,setForm]=useState(()=>buildTripFormState({trip,duplicateFrom,defaults}));
function applyTemplate(t){setSelectedTemplate(t.id);setForm(v=>({...v,category:t.category,durationMinutes:t.durationMinutes,adultPrice:t.adultPrice,childPrice:t.childPrice}))}
async function save(e){e.preventDefault();setBusy(true);setError("");const data=serializeTripForm(form);try{let created=null;if(trip)await updateTrip(token,trip._id,data);else created=await createTrip(token,data);saveProviderDefaults(providerId,{category:form.category,durationMinutes:Number(form.durationMinutes),adultPrice:Number(form.adultPrice),childPrice:Number(form.childPrice),buffetEnabled:Boolean(form.buffetEnabled),buffetAdultPrice:Number(form.buffetAdultPrice),buffetChildPrice:Number(form.buffetChildPrice),buffetDescription:form.buffetDescription,locationName:form.locationName,address:form.address,googleMapsUrl:form.googleMapsUrl});if(created&&onCreated)onCreated(created);else onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}}
return <section className="manage-form trip-form-simple"><div className="manage-form-head"><div><small>{trip?"EDIT TRIP":duplicateFrom?"DUPLICATE TRIP":"NEW TRIP"}</small><h2>{trip?"Edit trip":duplicateFrom?"Duplicate trip":"Add new trip"}</h2><p className="form-hint">{duplicateFrom?"Photos, pricing, duration and departure point were copied. Change only what is different.":"Add the essentials first. Extra settings are optional."}</p></div><button onClick={onCancel}>×</button></div><form onSubmit={save}>
{!trip&&!duplicateFrom&&<div className="trip-template-block"><div className="media-title"><b>Start with a template</b><small>Pick a common trip type, then change anything you want.</small></div><div className="trip-template-grid">{TRIP_TEMPLATES.map(t=><button key={t.id} type="button" className={selectedTemplate===t.id?"active":""} onClick={()=>applyTemplate(t)}><strong>{t.label}</strong><span>{t.durationMinutes} min</span></button>)}</div></div>}
<label>Trip name<input value={form.titleEn} onChange={e=>setForm({...form,titleEn:e.target.value})} placeholder="Example: Red Sea Snorkeling" required/></label>
<label className="vessel-field">Vessel / boat name<input maxLength="120" value={form.vesselName} onChange={e=>setForm({...form,vesselName:e.target.value})} placeholder="Enter vessel / boat name"/><small className="field-help">Shown to customers on trip details, bookings and tickets.</small></label>
<div className="form-grid"><label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{CATEGORIES.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label><label>Duration<input type="number" min="15" value={form.durationMinutes} onChange={e=>setForm({...form,durationMinutes:e.target.value})}/><small className="field-help">Minutes</small></label><label>Adult price<input type="number" min="0" step="0.5" value={form.adultPrice} onChange={e=>setForm({...form,adultPrice:e.target.value})}/><small className="field-help">JOD · age 13+</small></label><label>Child price<input type="number" min="0" step="0.5" value={form.childPrice} onChange={e=>setForm({...form,childPrice:e.target.value})}/><small className="field-help">JOD · age 6–12</small></label></div>
<div className="trip-media-manager"><div className="media-title"><b>Trip photos</b><small>The first image is the cover.</small></div><label className="device-upload">Upload from phone / device<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={async e=>{try{setBusy(true);setError("");const files=[...e.target.files].slice(0,Math.max(0,10-form.images.length));const uploaded=[];for(const file of files){const dataUrl=await resizeTripImage(file);uploaded.push(await uploadTripImage(token,dataUrl));}setForm(v=>({...v,images:[...v.images,...uploaded].slice(0,10)}));e.target.value=""}catch(err){setError(err.message)}finally{setBusy(false)}}}/><small>JPG, PNG or WebP</small></label>{form.images.length>0&&<div className="selected-images">{form.images.map((img,i)=>{const u=mediaUrl(img);return <div key={u+i}><img src={u} alt={"Trip "+(i+1)}/><button className="image-remove" type="button" onClick={()=>setForm(v=>({...v,images:v.images.filter((_,idx)=>idx!==i)}))}>×</button>{i===0?<span>COVER</span>:<button className="make-cover" type="button" onClick={()=>setForm(v=>({...v,images:[v.images[i],...v.images.filter((_,idx)=>idx!==i)]}))}>Cover</button>}<div className="image-order">{i>0&&<button type="button" onClick={()=>setForm(v=>{const a=[...v.images];[a[i-1],a[i]]=[a[i],a[i-1]];return {...v,images:a}})}>←</button>}{i<form.images.length-1&&<button type="button" onClick={()=>setForm(v=>{const a=[...v.images];[a[i],a[i+1]]=[a[i+1],a[i]];return {...v,images:a}})}>→</button>}</div></div>})}</div>}</div>
<button type="button" className="more-options-toggle" onClick={()=>setShowMore(v=>!v)}><span>{showMore?"Hide extra options":"More options"}</span><b>{showMore?"−":"+"}</b></button>
{showMore&&<div className="advanced-trip-options"><label>Arabic title<input value={form.titleAr} onChange={e=>setForm({...form,titleAr:e.target.value})} placeholder="Optional — English title is used if empty"/></label><label className="toggle-row"><input type="checkbox" checked={form.buffetEnabled} onChange={e=>setForm({...form,buffetEnabled:e.target.checked})}/> Open buffet option available</label>{form.buffetEnabled&&<><div className="form-grid"><label>Adult with buffet<input type="number" min="0" step="0.5" value={form.buffetAdultPrice} onChange={e=>setForm({...form,buffetAdultPrice:e.target.value})}/><small className="field-help">JOD</small></label><label>Child with buffet<input type="number" min="0" step="0.5" value={form.buffetChildPrice} onChange={e=>setForm({...form,buffetChildPrice:e.target.value})}/><small className="field-help">JOD</small></label></div><label>Buffet details<textarea rows="3" placeholder="Mixed grills, fish, rice, salads..." value={form.buffetDescription} onChange={e=>setForm({...form,buffetDescription:e.target.value})}/></label></>}<div className="advanced-section-label">Departure point</div><label>Location name<input value={form.locationName} onChange={e=>setForm({...form,locationName:e.target.value})} placeholder="Aqaba Marina"/></label><label>Address<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label><label>Google Maps URL<input value={form.googleMapsUrl} onChange={e=>setForm({...form,googleMapsUrl:e.target.value})}/></label><label className="toggle-row"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Publish this trip</label></div>}
{error&&<div className="error">{error}</div>}<button className="save-button" disabled={busy}>{busy?"Saving...":trip?"Save changes":duplicateFrom?"Create duplicate":"Create trip"}</button></form></section>}

function DepartureForm({token,trip,provider,wizard=false,onSaved,onCancel,onSkip}){
const providerId=provider?._id;
const defaults=accountDefaults(provider);
const[mode,setMode]=useState("quick");
const[startsAt,setStartsAt]=useState(()=>tomorrowLocal(defaults.lastDepartureTime||"09:00"));
const[capacity,setCapacity]=useState(defaults.capacity||20);
const[fromDate,setFromDate]=useState(()=>dateOnly(new Date(Date.now()+86400000)));
const[toDate,setToDate]=useState(()=>dateOnly(new Date(Date.now()+7*86400000)));
const[time,setTime]=useState(defaults.lastDepartureTime||"09:00");
const[repeat,setRepeat]=useState("daily");
const[weekdays,setWeekdays]=useState([0,1,2,3,4,5,6]);
const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[msg,setMsg]=useState("");
function buildDates(){const start=new Date(fromDate+"T00:00");const end=new Date(toDate+"T00:00");if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<start)return[];const out=[];for(let d=new Date(start);d<=end&&out.length<60;d.setDate(d.getDate()+1)){const day=d.getDay();const include=repeat==="daily"||(repeat==="weekends"&&(day===5||day===6))||(repeat==="selected"&&weekdays.includes(day));if(include)out.push(new Date(dateOnly(d)+"T"+time).toISOString())}return out}
async function save(e){e.preventDefault();setBusy(true);setError("");setMsg("");try{if(mode==="quick"){await createDeparture(token,{tripId:trip._id,startsAt:new Date(startsAt).toISOString(),capacity:Number(capacity)});saveProviderDefaults(providerId,Object.assign({},defaults,{capacity:Number(capacity),lastDepartureTime:String(startsAt).slice(11,16)}));onSaved();return}const startsAtList=buildDates();if(!startsAtList.length)throw new Error("Choose a valid date range");const r=await createDeparturesBulk(token,{tripId:trip._id,startsAtList,capacity:Number(capacity)});saveProviderDefaults(providerId,Object.assign({},defaults,{capacity:Number(capacity),lastDepartureTime:time}));setMsg(String(r.created)+" departure(s) created"+(r.skippedExisting?" · "+r.skippedExisting+" existing skipped":""));if(r.created>0)setTimeout(()=>onSaved(),450)}catch(e){setError(e.message)}finally{setBusy(false)}}
return <section className="manage-form schedule-form"><div className="manage-form-head"><div><small>{wizard?"STEP 2 OF 2":"SCHEDULE"}</small><h2>{wizard?"Schedule first departure":trip.titleEn}</h2><p className="form-hint">{wizard?"Your trip is created. Add the first departure now, or skip and do it later.":"Add one departure quickly or schedule many dates at once."}</p></div><button onClick={onCancel}>×</button></div><div className="schedule-tabs"><button type="button" className={mode==="quick"?"active":""} onClick={()=>setMode("quick")}>Quick</button><button type="button" className={mode==="bulk"?"active":""} onClick={()=>setMode("bulk")}>Multiple dates</button></div><form onSubmit={save}>{mode==="quick"?<label>Date & time<input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} required/></label>:<><div className="form-grid"><label>From<input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} required/></label><label>Until<input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} required/></label><label>Time<input type="time" value={time} onChange={e=>setTime(e.target.value)} required/></label><label>Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value)}><option value="daily">Every day</option><option value="weekends">Friday & Saturday</option><option value="selected">Selected days</option></select></label></div>{repeat==="selected"&&<div className="weekday-picker">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((x,i)=><button key={x} type="button" className={weekdays.includes(i)?"active":""} onClick={()=>setWeekdays(v=>v.includes(i)?v.filter(n=>n!==i):[...v,i])}>{x}</button>)}</div>}<div className="schedule-preview">{buildDates().length} departure(s) will be created</div></>}<label>Capacity<input type="number" min="1" max="500" value={capacity} onChange={e=>setCapacity(e.target.value)} required/></label>{error&&<div className="error">{error}</div>}{msg&&<div className="success-note">{msg}</div>}<button className="save-button" disabled={busy}>{busy?"Saving...":mode==="quick"?"Add departure":"Create "+buildDates().length+" departures"}</button>{wizard&&<button type="button" className="skip-schedule" onClick={onSkip}>Skip for now</button>}</form></section>}


function DepartureEditForm({token,departure,onSaved,onCancel,onOpenManifest}){
const local=new Date(departure.startsAt);local.setMinutes(local.getMinutes()-local.getTimezoneOffset());
const[startsAt,setStartsAt]=useState(local.toISOString().slice(0,16));const[capacity,setCapacity]=useState(departure.capacity);const[cancellationReason,setCancellationReason]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[msg,setMsg]=useState("");
const reserved=Number(departure.reservedSeats||0);const status=departure.status||"scheduled";const canMove=reserved===0&&status==="scheduled";const past=new Date(departure.startsAt)<=new Date();
async function save(e){e.preventDefault();setBusy(true);setError("");setMsg("");try{await updateDeparture(token,departure.id,{startsAt:new Date(startsAt).toISOString(),capacity:Number(capacity)});onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}}
async function cancelDeparture(){if(status!=="scheduled"||busy)return;if(!cancellationReason.trim()){setError("Add a cancellation reason first");return}if(!window.confirm("Cancel this departure?\n\nExisting bookings will be handled by the cancellation workflow."))return;setBusy(true);setError("");try{await updateDeparture(token,departure.id,{status:"cancelled",cancellationReason});onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}}
async function completeDeparture(){if(!past||status!=="scheduled"||busy)return;if(!window.confirm("Mark this departure as completed?"))return;setBusy(true);setError("");try{await updateDeparture(token,departure.id,{status:"completed"});onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}}
async function duplicateBy(days){if(busy)return;setBusy(true);setError("");setMsg("");try{const next=new Date(departure.startsAt);next.setDate(next.getDate()+days);await createDeparture(token,{tripId:departure.tripId?._id||departure.tripId,startsAt:next.toISOString(),capacity:Number(capacity)});setMsg("New departure created for "+next.toLocaleString([],{dateStyle:"medium",timeStyle:"short"}))}catch(e){setError(e.message)}finally{setBusy(false)}}
async function toggleSales(){if(status!=="scheduled"||busy)return;const closing=!Boolean(departure.salesClosed);if(closing&&!window.confirm("Close sales for this departure?\n\nIt will stop appearing as bookable to customers. Existing confirmed bookings stay valid."))return;setBusy(true);setError("");setMsg("");try{await updateDeparture(token,departure.id,{salesClosed:closing});setMsg(closing?"Sales closed. Existing bookings are unchanged.":"Sales reopened.");setTimeout(()=>onSaved(),350)}catch(e){setError(e.message)}finally{setBusy(false)}}
return <section className="manage-form departure-manage"><div className="manage-form-head"><div><small>MANAGE DEPARTURE</small><h2>{departure.tripId?.titleEn||departure.tripId?.titleAr||"Departure"}</h2><p className="form-hint">{new Date(departure.startsAt).toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</p></div><button onClick={onCancel}>×</button></div>
<div className="departure-overview"><div><span>Reserved</span><b>{reserved}</b></div><div><span>Capacity</span><b>{departure.capacity}</b></div><div><span>Available</span><b>{Math.max(0,Number(departure.capacity||0)-reserved)}</b></div></div>
<div className="departure-quick-actions">{onOpenManifest&&<button type="button" onClick={()=>onOpenManifest(departure.id)}><UsersRound size={15}/> Manifest</button>}<button type="button" disabled={busy||status!=="scheduled"} onClick={toggleSales}>{departure.salesClosed?<><CheckCircle2 size={15}/> Reopen sales</>:<><XCircle size={15}/> Sold out / close sales</>}</button><button type="button" disabled={busy||status!=="scheduled"} onClick={()=>duplicateBy(1)}><Plus size={15}/> Same time tomorrow</button><button type="button" disabled={busy||status!=="scheduled"} onClick={()=>duplicateBy(7)}><CalendarDays size={15}/> Same time next week</button></div>
<form onSubmit={save}><label>Date & time<input type="datetime-local" value={startsAt} disabled={!canMove} onChange={e=>setStartsAt(e.target.value)} required/>{!canMove&&reserved>0&&<small className="field-help">Time is locked because seats are already reserved.</small>}</label><label>Capacity<input type="number" min={Math.max(1,reserved)} max="500" value={capacity} disabled={status!=="scheduled"} onChange={e=>setCapacity(e.target.value)} required/><small className="field-help">Cannot be lower than {reserved} reserved seat(s).</small></label>{error&&<div className="error">{error}</div>}{msg&&<div className="success-note">{msg}</div>}{status==="scheduled"&&<button className="save-button" disabled={busy}>{busy?"Saving...":"Save changes"}</button>}</form>
{status==="scheduled"&&<div className="departure-status-actions">{past&&<button className="complete-action" disabled={busy} onClick={completeDeparture}><CheckCircle2 size={16}/> Mark completed</button>}<div className="danger-zone"><b>Cancel departure</b><span>Use this only when this departure will not operate.</span><textarea rows="2" placeholder="Reason: weather, technical issue..." value={cancellationReason} onChange={e=>setCancellationReason(e.target.value)}/><button disabled={busy} onClick={cancelDeparture}><XCircle size={16}/> Cancel departure</button></div></div>}
{status!=="scheduled"&&<div className={"departure-final-state "+status}><b>{status==="cancelled"?"Departure cancelled":"Departure completed"}</b><span>This departure can no longer be reactivated.</span></div>}</section>
}

function ProviderNotifications({token,onOpenBooking,onOpenManifest}){
  const[data,setData]=useState({unread:0,items:[]});const[error,setError]=useState("");const[loading,setLoading]=useState(true);
  const[push,setPush]=useState({supported:true,permission:"default",subscribed:false});const[pushBusy,setPushBusy]=useState(false);const[pushMsg,setPushMsg]=useState("");
  const standalone=window.matchMedia?.("(display-mode: standalone)")?.matches||window.navigator.standalone===true;
  const isiPhone=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  async function load(){setLoading(true);try{setData(await listNotifications(token));setError("")}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load();pushNotificationStatus().then(setPush).catch(()=>{})},[token]);
  async function read(n){if(!n.readAt){try{await markNotificationRead(token,n._id);setData(d=>({...d,unread:Math.max(0,d.unread-1),items:d.items.map(x=>x._id===n._id?{...x,readAt:new Date().toISOString()}:x)}))}catch{}}const bookingId=n.bookingId?._id||n.bookingId;const departureId=n.data?.departureId;if((n.data?.screen==="manifest"||n.type==="provider_departure_reminder_24h")&&departureId){onOpenManifest?.(String(departureId));return}if(bookingId){onOpenBooking?.(String(bookingId));}}
  async function readAll(){await markAllNotificationsRead(token);setData(d=>({unread:0,items:d.items.map(x=>({...x,readAt:x.readAt||new Date().toISOString()}))}))}
  async function enablePush(){setPushBusy(true);setPushMsg("");try{await enablePushNotifications(token);setPush(await pushNotificationStatus());setPushMsg("Push notifications enabled.");}catch(e){setPushMsg(e.message)}finally{setPushBusy(false)}}
  async function testPush(){setPushBusy(true);setPushMsg("");try{const r=await sendTestPush(token);setPushMsg(r.sent>0?"Test push sent.":"No active push subscription found.");}catch(e){setPushMsg(e.message)}finally{setPushBusy(false)}}
  return <section><div className="section-toolbar"><div><h2>Notifications</h2><span className="notification-count">{data.unread} unread</span></div>{data.unread>0&&<button onClick={readAll}>Mark all read</button>}</div>
    <div className="push-card-provider"><div><b>Push notifications</b><span>{push.subscribed?"Enabled on this device":push.supported?"Receive new booking alerts when the app is closed":"Not supported on this browser"}</span></div>
      {!push.subscribed&&push.supported&&<button disabled={pushBusy||(isiPhone&&!standalone)} onClick={enablePush}>{pushBusy?"Enabling...":"Enable"}</button>}
      {push.subscribed&&<button disabled={pushBusy} onClick={testPush}>Test</button>}
      {isiPhone&&!standalone&&<small>On iPhone: Share → Add to Home Screen, then open the Provider app from the Home Screen.</small>}
      {push.permission==="denied"&&<small>Notifications are blocked in iPhone settings for this web app.</small>}
      {pushMsg&&<small>{pushMsg}</small>}
    </div>
    {error&&<div className="error">{error}</div>}{loading?<p className="muted">Loading notifications...</p>:data.items.length?<div className="provider-notification-list">{data.items.map(n=>{const actionable=Boolean((n.data?.screen==="manifest"&&n.data?.departureId)||n.bookingId);return <button key={n._id} className={"provider-notification "+(!n.readAt?"unread":"")+(actionable?" actionable":"")} onClick={()=>read(n)}><Bell size={18}/><div><b>{n.title}</b><span>{n.body}</span><small>{new Date(n.createdAt).toLocaleString()}</small>{actionable&&<strong className="notification-action-label">{n.data?.screen==="manifest"?"Open manifest":"Open booking"} →</strong>}</div>{!n.readAt&&<i/>}</button>})}</div>:<p className="muted">No notifications yet.</p>}</section>
}

function BookingDetail({token,bookingId,onClose,onOpenManifest}){
const[data,setData]=useState(null);const[error,setError]=useState("");const[busy,setBusy]=useState(false);
async function load(){try{setData(await bookingDetail(token,bookingId));setError("")}catch(e){setError(e.message)}}
useEffect(()=>{load()},[bookingId,token]);
async function manualCheckIn(){if(!data||data.checkedInAt||busy)return;if(!window.confirm("Check in this booking manually?\n\nConfirm the guest identity first."))return;setBusy(true);setError("");try{await manualCheckInBooking(token,bookingId);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
if(error&&!data)return <div className="detail-sheet"><div className="manage-form-head"><h2>Booking details</h2><button onClick={onClose}>×</button></div><div className="error">{error}</div></div>;
if(!data)return <div className="detail-sheet"><div className="loading">Loading booking...</div></div>;
const phone=String(data.customerId?.phone||"").trim();const wa=whatsappNumber(phone);const departure=data.departureId?.startsAt?new Date(data.departureId.startsAt):null;const departureId=data.departureId?._id||data.departureId;
return <div className="detail-sheet booking-detail-sheet"><div className="manage-form-head"><div><small>BOOKING</small><h2>{data.bookingReference}</h2><p className="form-hint">{data.tripId?.titleEn||data.tripId?.titleAr}</p></div><button onClick={onClose}>×</button></div>{error&&<div className="error">{error}</div>}
<div className="booking-detail-hero"><div><span>Guest</span><h3>{data.customerId?.name||"Guest"}</h3><p>{data.customerId?.phone||data.customerId?.email||""}</p></div><em className={data.checkedInAt?"used":"valid"}>{data.checkedInAt?"CHECKED IN":"PENDING"}</em></div>
<div className="detail-actions detail-actions-grid">{phone&&<a href={"tel:"+phone}>Call</a>}{wa&&<a href={"https://wa.me/"+wa} target="_blank" rel="noreferrer">WhatsApp</a>}{data.tripId?.departureLocation?.googleMapsUrl&&<a href={data.tripId.departureLocation.googleMapsUrl} target="_blank" rel="noreferrer">Maps</a>}{departureId&&onOpenManifest&&<button onClick={()=>onOpenManifest(String(departureId))}>Manifest</button>}</div>
{!data.checkedInAt&&data.status==="confirmed"&&data.departureId?.status==="scheduled"&&<button className="booking-checkin-cta" disabled={busy} onClick={manualCheckIn}><CheckCircle2 size={17}/>{busy?"Checking in...":"Check in manually"}</button>}
<div className="detail-grid booking-detail-grid"><div><span>Departure</span><b>{departure?departure.toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):"TBA"}</b></div><div><span>Guests</span><b>{data.adults||0} adult(s) · {data.children||0} child(ren)</b></div><div><span>Package</span><b>{data.mealPlan==="with_buffet"?"Open buffet":"Without buffet"}</b></div><div><span>Payment</span><b>{data.payment?.status?.toUpperCase()||"UNKNOWN"}</b></div><div><span>Total</span><b>{Number(data.pricing?.grossAmount||0).toFixed(2)} {data.pricing?.currency||"JOD"}</b></div><div><span>Status</span><b>{String(data.status||"").toUpperCase()}</b></div></div>
{data.tripId?.departureLocation?.name&&<div className="detail-card compact-location"><span>Departure point</span><h3>{data.tripId.departureLocation.name}</h3>{data.tripId.departureLocation.address&&<p>{data.tripId.departureLocation.address}</p>}</div>}</div>
}

function ManifestScreen({token,departureId,onClose,onOpenBooking}){
const[data,setData]=useState(null);const[error,setError]=useState("");const[search,setSearch]=useState("");const[filter,setFilter]=useState("pending");const[busyId,setBusyId]=useState("");
async function load(){try{setData(await departureManifest(token,departureId));setError("")}catch(e){setError(e.message)}}
useEffect(()=>{load()},[token,departureId]);
async function manualCheckIn(b){if(b.checkedInAt||busyId)return;const name=b.customer?.name||"Guest";if(!window.confirm("Check in "+name+" manually?\n\nUse this only after confirming the guest identity."))return;setBusyId(b.id);try{await manualCheckInBooking(token,b.id);await load()}catch(e){setError(e.message)}finally{setBusyId("")}}
if(error&&!data)return <div className="detail-sheet"><div className="manage-form-head"><h2>Passenger manifest</h2><button onClick={onClose}>×</button></div><div className="error">{error}</div></div>;
if(!data)return <div className="detail-sheet"><div className="loading">Loading manifest...</div></div>;
const source=filter==="all"?data.bookings:filter==="checked"?data.bookings.filter(b=>b.checkedInAt):data.bookings.filter(b=>!b.checkedInAt);
const rows=source.filter(b=>[b.customer?.name,b.customer?.phone,b.customer?.email,b.bookingReference].join(" ").toLowerCase().includes(search.toLowerCase()));
const d=data.departure;
return <div className="detail-sheet manifest-sheet"><div className="manage-form-head"><div><small>PASSENGER MANIFEST</small><h2>{d.trip?.titleEn||d.trip?.titleAr}</h2><p>{new Date(d.startsAt).toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</p></div><button onClick={onClose}>×</button></div>{error&&<div className="error">{error}</div>}<div className="manifest-stats"><div><span>Bookings</span><b>{data.summary.bookings}</b></div><div><span>Guests</span><b>{data.summary.guests}</b></div><div><span>Checked in</span><b>{data.summary.checkedInGuests}</b></div><div><span>Remaining</span><b>{data.summary.remainingGuests}</b></div></div><div className="manifest-toolbar"><div className="booking-filters">{[["pending","Pending"],["checked","Checked-in"],["all","All"]].map(([id,label])=><button key={id} className={filter===id?"active":""} onClick={()=>setFilter(id)}>{label}</button>)}</div><input className="booking-search manifest-search" placeholder="Search passenger" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="manifest-list">{rows.length?rows.map(b=>{const phone=b.customer?.phone;return <article className="manifest-card" key={b.id}><button className="manifest-row manifest-main" onClick={()=>onOpenBooking(b.id)}><div><b>{b.customer?.name||"Guest"}</b><span>{b.bookingReference} · {b.seats} guest(s){b.adults!==undefined?" · "+b.adults+"A/"+(b.children||0)+"C":""}</span><span>{phone||b.customer?.email||""}</span><span>{b.mealPlan==="with_buffet"?"Open buffet":"Without buffet"}</span></div><em className={b.checkedInAt?"used":"valid"}>{b.checkedInAt?"CHECKED IN":"WAITING"}</em></button><div className="manifest-actions">{phone&&<a href={"tel:"+phone}>Call</a>}{phone&&<a href={"https://wa.me/"+whatsappNumber(phone)} target="_blank" rel="noreferrer">WhatsApp</a>}{!b.checkedInAt?<button className="manual-checkin" disabled={busyId===b.id} onClick={()=>manualCheckIn(b)}>{busyId===b.id?"Checking...":"Check in"}</button>:<button onClick={()=>onOpenBooking(b.id)}>Details</button>}</div></article>}):<p className="muted">No matching passengers.</p>}</div></div>
}

function ProviderOnboarding({provider,trips,departures,onSettings,onCreateTrip,onSchedule}){
const setupDone=Boolean(provider?.settings?.configured);
const tripDone=trips.length>0;
const departureDone=departures.some(d=>d.status==="scheduled"&&new Date(d.startsAt)>new Date());
const steps=[
  {id:"settings",title:"Set your defaults",desc:"Save your phone, departure point, capacity and usual time.",done:setupDone,action:onSettings,label:"Open settings"},
  {id:"trip",title:"Create your first trip",desc:"Add the experience customers will book.",done:tripDone,action:onCreateTrip,label:"Create trip"},
  {id:"schedule",title:"Schedule a departure",desc:"Choose the first date, time and capacity.",done:departureDone,action:onSchedule,label:"Schedule"}
];
const complete=steps.filter(s=>s.done).length;
if(complete===steps.length)return null;
return <section className="provider-onboarding"><div className="onboarding-progress-head"><div><small>SETUP</small><h2>Finish account setup</h2><p>{complete} of {steps.length} required steps completed</p></div><strong>{Math.round(complete/steps.length*100)}%</strong></div><div className="onboarding-progress"><i style={{width:(complete/steps.length*100)+"%"}}/></div><div className="provider-setup-list">{steps.filter(s=>!s.done).map((s,i)=><div className="provider-setup-step" key={s.id}><div className="setup-step-number">{i+1}</div><div><b>{s.title}</b><span>{s.desc}</span></div><button onClick={s.action}>{s.label}</button></div>)}</div></section>
}

function ProviderSettings({token,provider,onSaved,onCancel}){
const local=loadProviderDefaults(provider?._id);const server=provider?.settings?.configured?provider.settings:null;
const[form,setForm]=useState(()=>({phone:provider?.phone||"",defaultCapacity:server?.defaultCapacity||local.capacity||20,defaultDepartureTime:server?.defaultDepartureTime||local.lastDepartureTime||"09:00",locationName:server?.departureLocation?.name||local.locationName||"",address:server?.departureLocation?.address||local.address||"",googleMapsUrl:server?.departureLocation?.googleMapsUrl||local.googleMapsUrl||""}));
const[countryCode,setCountryCode]=useState("+962");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
async function save(e){e.preventDefault();setBusy(true);setError("");try{const updated=await updateProviderSettings(token,{phone:internationalPhone(form.phone,countryCode),defaultCapacity:Number(form.defaultCapacity),defaultDepartureTime:form.defaultDepartureTime,departureLocation:{name:form.locationName,address:form.address,googleMapsUrl:form.googleMapsUrl}});saveProviderDefaults(provider?._id,{...local,capacity:Number(form.defaultCapacity),lastDepartureTime:form.defaultDepartureTime,locationName:form.locationName,address:form.address,googleMapsUrl:form.googleMapsUrl});onSaved(updated)}catch(e){setError(e.message)}finally{setBusy(false)}}
return <section className="manage-form settings-form"><div className="manage-form-head"><div><small>PROVIDER SETTINGS</small><h2>Defaults & contact</h2><p className="form-hint">These defaults follow your account across devices.</p></div><button onClick={onCancel}>×</button></div><form onSubmit={save}><label>Business phone<CountryPhoneField code={countryCode} setCode={setCountryCode} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="7X XXX XXXX"/></label><div className="form-grid"><label>Default capacity<input type="number" min="1" max="500" value={form.defaultCapacity} onChange={e=>setForm({...form,defaultCapacity:e.target.value})} required/></label><label>Default departure time<input type="time" value={form.defaultDepartureTime} onChange={e=>setForm({...form,defaultDepartureTime:e.target.value})} required/></label></div><div className="advanced-trip-options"><div className="advanced-section-label">Default departure point</div><label>Location name<input value={form.locationName} onChange={e=>setForm({...form,locationName:e.target.value})} placeholder="Example: Aqaba Marina"/></label><label>Address<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Aqaba, Jordan"/></label><label>Google Maps URL<input value={form.googleMapsUrl} onChange={e=>setForm({...form,googleMapsUrl:e.target.value})} placeholder="https://maps.google.com/..."/></label></div>{error&&<div className="error">{error}</div>}<button className="save-button" disabled={busy}>{busy?"Saving...":"Save settings"}</button></form></section>}

function ProviderTeam({token,onClose}){
const[data,setData]=useState(null);const[audit,setAudit]=useState([]);const[countryCode,setCountryCode]=useState("+962");const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[form,setForm]=useState({name:"",email:"",phone:"",password:"",role:"staff"});
async function loadTeam(){try{const[d,a]=await Promise.all([providerTeam(token),providerAuditLog(token)]);setData(d);setAudit(a);setError("")}catch(e){setError(e.message)}}
useEffect(()=>{loadTeam()},[token]);
async function add(e){e.preventDefault();setBusy(true);setError("");try{await createProviderTeamMember(token,{...form,phone:internationalPhone(form.phone,countryCode)});setForm({name:"",email:"",phone:"",password:"",role:"staff"});await loadTeam()}catch(e){setError(e.message)}finally{setBusy(false)}}
async function change(m,patch){setBusy(true);setError("");try{await updateProviderTeamMember(token,m.id,patch);await loadTeam()}catch(e){setError(e.message)}finally{setBusy(false)}}
return <section className="manage-form team-form"><div className="manage-form-head"><div><small>PROVIDER TEAM</small><h2>Team access</h2><p className="form-hint">Each person signs in with their own account. No shared password needed.</p></div><button onClick={onClose}>×</button></div>{error&&<div className="error">{error}</div>}
<div className="team-role-help"><span><b>Manager</b> Trips, departures, bookings, finance</span><span><b>Staff</b> Departures, bookings, check-in</span><span><b>Check-in</b> Manifest and QR/manual check-in only</span></div>
<div className="team-list">{data?.owner&&<div className="team-row owner"><div><b>{data.owner.name}</b><span>{data.owner.email}</span></div><em>OWNER</em></div>}{data?.members?.map(m=><div className="team-row" key={m.id}><div><b>{m.name}</b><span>{m.email}</span></div><div className="team-row-actions"><select disabled={busy||!m.isActive} value={m.role} onChange={e=>change(m,{role:e.target.value})}><option value="manager">Manager</option><option value="staff">Staff</option><option value="checkin">Check-in</option></select><button className={m.isActive?"team-disable":"team-enable"} disabled={busy} onClick={()=>change(m,{isActive:!m.isActive})}>{m.isActive?"Disable":"Enable"}</button></div></div>)}</div>
<div className="team-audit"><div className="advanced-section-label">Recent activity</div>{audit.length?audit.slice(0,30).map(x=><div className="audit-row" key={x.id}><div><b>{x.summary}</b><span>{x.actor?.name||"User"} · {String(x.actor?.role||"").replace("checkin","check-in")}</span></div><time>{new Date(x.createdAt).toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</time></div>):<p className="muted">No recorded activity yet.</p>}</div>
<form className="team-add" onSubmit={add}><div className="advanced-section-label">Add team member</div><div className="form-grid"><label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Email<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Phone<CountryPhoneField code={countryCode} setCode={setCountryCode} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="manager">Manager</option><option value="staff">Staff</option><option value="checkin">Check-in staff</option></select></label></div><label>Temporary password<input required type="password" minLength="8" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><small className="field-help">Share it securely with the employee.</small></label><button className="save-button" disabled={busy}>{busy?"Adding...":"Add team member"}</button></form></section>}

export default function App(){const[auth,setAuth]=useState(authStore());const[provider,setProvider]=useState(null);const[profileMissing,setProfileMissing]=useState(false);const[tab,setTab]=useState(()=>new URLSearchParams(window.location.search).get("open")==="notifications"?"notifications":"home");const[date,setDate]=useState(today());const[tripRows,setTripRows]=useState([]);const[depRows,setDepRows]=useState([]);const[upcomingDepRows,setUpcomingDepRows]=useState([]);const[bookingRows,setBookingRows]=useState([]);const[allBookingRows,setAllBookingRows]=useState([]);const[bookingFilter,setBookingFilter]=useState("today");const[loading,setLoading]=useState(false);const[scanner,setScanner]=useState(false);const[error,setError]=useState("");const[editingTrip,setEditingTrip]=useState(null);const[addingTrip,setAddingTrip]=useState(false);const[duplicateTrip,setDuplicateTrip]=useState(null);const[newTripWizard,setNewTripWizard]=useState(null);const[departureTrip,setDepartureTrip]=useState(null);const[editingDeparture,setEditingDeparture]=useState(null);const[bookingSearch,setBookingSearch]=useState("");const[selectedBooking,setSelectedBooking]=useState(null);const[bookingReturnManifest,setBookingReturnManifest]=useState(null);const[manifestDeparture,setManifestDeparture]=useState(null);const[settingsOpen,setSettingsOpen]=useState(false);const[teamOpen,setTeamOpen]=useState(false);const[quickUpdating,setQuickUpdating]=useState("");const[onboardingPush,setOnboardingPush]=useState({supported:true,permission:"default",subscribed:false});
useEffect(()=>{
  const expired=()=>{setAuth(null);setProvider(null);setProfileMissing(false);setTripRows([]);setDepRows([]);setBookingRows([]);setAllBookingRows([]);setError("Your session expired. Please sign in again.");};
  window.addEventListener("seago:session-expired",expired);
  return()=>window.removeEventListener("seago:session-expired",expired);
},[]);
async function load(){if(!auth?.token)return;setLoading(true);setError("");try{let p;try{p=await me(auth.token)}catch(e){if(e.status===404){setProvider(null);setProfileMissing(true);setTripRows([]);setDepRows([]);setUpcomingDepRows([]);setBookingRows([]);setAllBookingRows([]);return}throw e}setProvider(p);setProfileMissing(false);if(p.status!=="approved"){setTripRows([]);setDepRows([]);setUpcomingDepRows([]);setBookingRows([]);setAllBookingRows([]);return}const[t,d,upcoming,b,allB]=await Promise.all([trips(auth.token),departures(auth.token,date),departures(auth.token),bookings(auth.token,date),bookings(auth.token)]);setTripRows(t);setDepRows(d);setUpcomingDepRows(upcoming);setBookingRows(b);setAllBookingRows(allB)}catch(e){setError(e.message)}finally{setLoading(false)}}
useEffect(()=>{load()},[auth?.token,date]);useEffect(()=>{if(auth?.token)pushNotificationStatus().then(setOnboardingPush).catch(()=>{})},[auth?.token,tab]);
async function quickSetSales(departureId,salesClosed){
  if(!canManageDepartures||quickUpdating)return;
  setQuickUpdating(String(departureId));
  setError("");
  try{
    await updateDeparture(auth.token,departureId,{salesClosed});
    await load();
  }catch(e){
    setError(e.message||"Could not update departure sales.");
  }finally{
    setQuickUpdating("");
  }
}if(!auth)return <Login onDone={setAuth}/>;const signOut=()=>{localStorage.removeItem("seago_provider_auth");setAuth(null);setProvider(null);setProfileMissing(false)};if(loading&&!provider&&!profileMissing)return <div className="onboarding-shell"><div className="loading">Loading provider account...</div></div>;if(profileMissing)return <ProviderProfileSetup token={auth.token} onCreated={p=>{setProvider(p);setProfileMissing(false)}}/>;if(provider&&provider.status!=="approved")return <ProviderApprovalStatus provider={provider} onRefresh={load} onSignOut={signOut}/>;if(scanner)return <Scanner token={auth.token} onClose={()=>setScanner(false)} onDone={load}/>;
const checked=bookingRows.filter(b=>b.checkedInAt).length;const guests=bookingRows.reduce((s,b)=>s+Number(b.seats||0),0);const isToday=date===today();const dayLabel=isToday?"Today":new Date(date+"T12:00:00").toLocaleDateString([],{weekday:"short",day:"numeric",month:"short"});const caps=new Set(provider?.capabilities||[]);const canManageTrips=caps.has("manage_trips");const canManageDepartures=caps.has("manage_departures");const canFinance=caps.has("view_finance");const canSettings=caps.has("manage_settings");const canTeam=caps.has("manage_team");const homeScopeDeps=depRows.length?depRows:upcomingDepRows;const homeScopeLabel=depRows.length?dayLabel:"Upcoming";const homeDepIds=new Set(homeScopeDeps.map(d=>String(d.id)));const homeScopeBookings=allBookingRows.filter(b=>homeDepIds.has(String(b.departureId?._id||b.departureId)));const homeBookings=homeScopeBookings.length;const homeGuests=homeScopeBookings.reduce((sum,b)=>sum+Number(b.seats||0),0);const homeNet=homeScopeBookings.reduce((sum,b)=>sum+Number(b.pricing?.providerNetAmount||0),0);
if(teamOpen)return <div className="app"><header><ProviderBrand/></header><main><ProviderTeam token={auth.token} onClose={()=>setTeamOpen(false)}/></main></div>;if(settingsOpen)return <div className="app"><header><ProviderBrand/></header><main><ProviderSettings token={auth.token} provider={provider} onCancel={()=>setSettingsOpen(false)} onSaved={updated=>{setProvider(updated);setSettingsOpen(false)}}/></main></div>;
if(addingTrip||editingTrip||duplicateTrip)return <div className="app"><header><ProviderBrand/></header><main><TripForm token={auth.token} provider={provider} trip={editingTrip} duplicateFrom={duplicateTrip} onCancel={()=>{setAddingTrip(false);setEditingTrip(null);setDuplicateTrip(null)}} onCreated={created=>{setAddingTrip(false);setDuplicateTrip(null);setNewTripWizard(created)}} onSaved={async()=>{setAddingTrip(false);setEditingTrip(null);setDuplicateTrip(null);await load()}}/></main></div>;
if(newTripWizard)return <div className="app"><header><ProviderBrand/></header><main><DepartureForm token={auth.token} provider={provider} trip={newTripWizard} wizard onCancel={()=>setNewTripWizard(null)} onSkip={async()=>{setNewTripWizard(null);await load()}} onSaved={async()=>{setNewTripWizard(null);await load()}}/></main></div>;
if(departureTrip)return <div className="app"><header><ProviderBrand/></header><main><DepartureForm token={auth.token} provider={provider} trip={departureTrip} onCancel={()=>setDepartureTrip(null)} onSaved={async()=>{setDepartureTrip(null);await load()}}/></main></div>;if(editingDeparture)return <div className="app"><header><ProviderBrand/></header><main><DepartureEditForm token={auth.token} departure={editingDeparture} onOpenManifest={id=>{setEditingDeparture(null);setManifestDeparture(id)}} onCancel={()=>setEditingDeparture(null)} onSaved={async()=>{setEditingDeparture(null);await load()}}/></main></div>;if(selectedBooking)return <div className="app"><header><ProviderBrand/></header><main><BookingDetail token={auth.token} bookingId={selectedBooking} onOpenManifest={id=>{setSelectedBooking(null);setManifestDeparture(id)}} onClose={()=>{setSelectedBooking(null);if(bookingReturnManifest){setManifestDeparture(bookingReturnManifest);setBookingReturnManifest(null)}}}/></main></div>;if(manifestDeparture)return <div className="app"><header><ProviderBrand/></header><main><ManifestScreen token={auth.token} departureId={manifestDeparture} onClose={()=>setManifestDeparture(null)} onOpenBooking={id=>{setBookingReturnManifest(manifestDeparture);setManifestDeparture(null);setSelectedBooking(id)}}/></main></div>;
return <div className="app"><header><ProviderBrand/><div className="header-actions"><span className="provider-role-badge">{String(provider?.accessRole||"owner").replace("checkin","check-in")}</span><button className="header-refresh" aria-label="Refresh dashboard" title="Refresh" onClick={load} disabled={loading}><RefreshCw size={18} className={loading?"spin":""}/><span>Refresh</span></button>{canTeam&&<button className="logout" aria-label="Manage team" onClick={()=>setTeamOpen(true)}><UsersRound size={18}/></button>}{canSettings&&<button className="logout" aria-label="Provider settings" onClick={()=>setSettingsOpen(true)}><Settings size={18}/></button>}<button className="logout" aria-label="Sign out" onClick={signOut}><LogOut size={18}/></button></div></header><main>
<div className="welcome"><div><h1>{provider?.businessName||"SeaGo Partner"}</h1></div><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
{error&&<div className="error">{error}</div>}{loading?<div className="loading">Loading dashboard...</div>:<>
{tab==="home"&&canManageTrips&&canSettings&&<ProviderOnboarding provider={provider} trips={tripRows} departures={upcomingDepRows} push={onboardingPush} onSettings={()=>setSettingsOpen(true)} onCreateTrip={()=>setAddingTrip(true)} onSchedule={()=>{if(tripRows[0])setDepartureTrip(tripRows[0]);else setAddingTrip(true)}} onNotifications={()=>setTab("notifications")}/>}
{tab==="home"&&canManageDepartures&&(depRows.length>0||upcomingDepRows.length>0)&&<section className="quick-today">
  <div className="quick-today-head"><div><small>{homeScopeLabel.toUpperCase()} · TRIPS</small><h2>{depRows.length?"Today's trips":"Next trips"}</h2><p>{depRows.length?"Control sales, passengers and trip details from here.":"No trips today — showing your next upcoming departures."}</p></div></div>
  <div className="quick-today-list">
    {[...(depRows.length?depRows:upcomingDepRows.slice(0,4))].sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt)).map(d=>{
      const busy=quickUpdating===String(d.id);
      const available=Math.max(0,Number(d.capacity||0)-Number(d.reservedSeats||0));
      const soldOut=available===0;
      const salesClosed=Boolean(d.salesClosed);
      const salesOpen=d.status==="scheduled"&&!salesClosed&&!soldOut;
      const statusLabel=d.status!=="scheduled"?String(d.status||"").toUpperCase():soldOut?"SOLD OUT":salesClosed?"SALES CLOSED":"OPEN";
      return <article className={"quick-trip-card "+(salesOpen?"is-open":"is-closed")} key={"quick-"+d.id}>
        <div className="quick-trip-main"><div className="quick-trip-time"><Clock size={16}/><b>{depRows.length?new Date(d.startsAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):new Date(d.startsAt).toLocaleString([],{timeZone:"Asia/Amman",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</b></div><div><h3>{d.tripId?.titleEn||d.tripId?.titleAr}</h3><span>{d.reservedSeats}/{d.capacity} reserved · {available} available</span></div><em>{statusLabel}</em></div>
        <div className="quick-trip-actions">
          {d.status==="scheduled"&&!soldOut&&(salesClosed
            ?<button className="sales-action open" disabled={busy} onClick={()=>quickSetSales(d.id,false)}><CheckCircle2 size={15}/> {busy?"Updating...":"Open sales"}</button>
            :<button className="sales-action close" disabled={busy} onClick={()=>quickSetSales(d.id,true)}><XCircle size={15}/> {busy?"Updating...":"Close sales"}</button>)}
          <button onClick={()=>setManifestDeparture(d.id)}><UsersRound size={15}/> Passengers</button>
          <button onClick={()=>setEditingDeparture(d)}><Pencil size={15}/> Manage</button>
        </div>
      </article>
    })}
  </div>
</section>}
{tab==="home"&&<section className="home-summary"><div className="home-summary-head"><small>{homeScopeLabel.toUpperCase()} SUMMARY</small></div><div className="home-summary-grid"><div><Ticket/><span>Bookings</span><b>{homeBookings}</b></div><div><UsersRound/><span>Guests</span><b>{homeGuests}</b></div>{canFinance?<div className="home-summary-net"><span>{depRows.length?"Net for selected day":"Upcoming net"}</span><b>{homeNet.toFixed(2)} JOD</b></div>:<div><CalendarDays/><span>Departures</span><b>{homeScopeDeps.length}</b></div>}</div></section>}
{tab==="trips"&&canManageTrips&&<section><div className="section-toolbar"><div><h2>My trips</h2><span className="notification-count">{tripRows.length} trip(s)</span></div><button onClick={()=>setAddingTrip(true)}><Plus size={16}/> Add trip</button></div>{tripRows.length?<div className="trip-card-grid">{tripRows.map(t=>{const cover=mediaUrl(t.images?.[0]);const next=t.schedule?.nextDepartureAt?new Date(t.schedule.nextDepartureAt):null;return <article className="trip-card" key={t._id}><div className="trip-card-media">{cover?<img src={cover} alt={t.titleEn}/>:<div className="trip-card-placeholder"><ShipWheel size={28}/></div>}<span className={"trip-state "+(t.active?"active":"inactive")}>{t.active?"ACTIVE":"PAUSED"}</span></div><div className="trip-card-body"><div className="trip-card-title"><div><h3>{t.titleEn}</h3><span>{t.category.replaceAll("_"," ")} · {t.durationMinutes} min</span></div><b>{t.pricing?.adultPrice??t.pricing?.pricePerPerson} JOD</b></div><div className="trip-card-meta"><span><MapPin size={13}/>{t.departureLocation?.name||"No departure point"}</span><span><CalendarDays size={13}/>{t.schedule?.upcomingDepartures||0} upcoming · {t.schedule?.reservedSeatsUpcoming||0} booked</span>{next&&<span><Clock size={13}/>Next {next.toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</span>}</div><div className="trip-card-actions"><button className="primary-action" onClick={()=>setDepartureTrip(t)}><CalendarDays size={16}/> Schedule</button><button className="edit-action" onClick={()=>setEditingTrip(t)}><Pencil size={16}/> Edit</button></div><button className="duplicate-inline" onClick={()=>setDuplicateTrip(t)}><Plus size={13}/> Duplicate trip</button></div></article>})}</div>:<div className="empty-trip-state"><ShipWheel size={34}/><h3>No trips yet</h3><p>Create your first trip and schedule the first departure in a few steps.</p><button onClick={()=>setAddingTrip(true)}><Plus size={16}/> Create first trip</button></div>}</section>}
{tab==="notifications"&&<ProviderNotifications token={auth.token} onOpenBooking={id=>setSelectedBooking(id)} onOpenManifest={id=>setManifestDeparture(id)}/>}
{tab==="bookings"&&(()=>{const now=new Date();const todayKey=today();const source=bookingFilter==="today"?allBookingRows.filter(b=>b.departureId?.startsAt&&new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Amman",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(b.departureId.startsAt))===todayKey):bookingFilter==="upcoming"?allBookingRows.filter(b=>b.departureId?.startsAt&&new Date(b.departureId.startsAt)>=now):bookingFilter==="pending"?allBookingRows.filter(b=>b.departureId?.startsAt&&new Date(b.departureId.startsAt)>=now&&!b.checkedInAt):allBookingRows.filter(b=>Boolean(b.checkedInAt));const filtered=source.filter(b=>{const ref="SG-"+String(b._id).slice(-8).toUpperCase();const hay=[b.customerId?.name,b.customerId?.phone,b.customerId?.email,b.tripId?.titleEn,b.tripId?.titleAr,ref].join(" ").toLowerCase();return hay.includes(bookingSearch.toLowerCase())});return <section><div className="section-toolbar"><div><h2>Bookings</h2><span className="notification-count">{filtered.length} shown</span></div><input className="booking-search" placeholder="Search guest or booking" value={bookingSearch} onChange={e=>setBookingSearch(e.target.value)}/></div><div className="booking-filters">{[["today","Today"],["upcoming","Upcoming"],["pending","Not checked-in"],["checked","Checked-in"]].map(([id,label])=><button key={id} className={bookingFilter===id?"active":""} onClick={()=>setBookingFilter(id)}>{label}</button>)}</div>{filtered.length?<div className="booking-card-list">{filtered.map(b=>{const ref="SG-"+String(b._id).slice(-8).toUpperCase();const start=b.departureId?.startsAt?new Date(b.departureId.startsAt):null;const phone=b.customerId?.phone;return <article className="booking-card" key={b._id}><button className="booking-card-main" onClick={()=>setSelectedBooking(b._id)}><div><b>{b.customerId?.name||"Guest"}</b><span>{ref} · {b.tripId?.titleEn||b.tripId?.titleAr}</span><span>{b.seats} guest(s){start?" · "+start.toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):""}</span></div><em className={b.checkedInAt?"used":"valid"}>{b.checkedInAt?"CHECKED IN":"PENDING"}</em></button><div className="booking-quick-actions">{phone&&<a href={"tel:"+phone}>Call</a>}{phone&&<a href={"https://wa.me/"+String(phone).replace(/\D/g,"")} target="_blank" rel="noreferrer">WhatsApp</a>}<button onClick={()=>setSelectedBooking(b._id)}>Details</button></div></article>})}</div>:<div className="empty-booking-state"><Ticket size={30}/><h3>No bookings here</h3><p>Try another filter or search term.</p></div>}</section>})()}
</>}</main><nav><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><Home/><span>Home</span></button>{canManageTrips&&<button className={tab==="trips"?"active":""} onClick={()=>setTab("trips")}><ShipWheel/><span>Trips</span></button>}<button className="scan" onClick={()=>setScanner(true)}><QrCode/><span>Scan</span></button><button className={tab==="notifications"?"active":""} onClick={()=>setTab("notifications")}><Bell/><span>Alerts</span></button><button className={tab==="bookings"?"active":""} onClick={()=>setTab("bookings")}><Ticket/><span>Bookings</span></button></nav></div>}
