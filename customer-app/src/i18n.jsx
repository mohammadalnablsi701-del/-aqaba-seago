import React,{createContext,useContext,useEffect,useMemo,useState}from"react";

const translations={
  en:{
    "home.hero.eyebrow":"ESCAPE · EXPLORE · REMEMBER",
    "home.hero.title":"Make Aqaba Unforgettable",
    "home.hero.subtitle":"Your next Red Sea memory starts here.",
    "home.tripType":"Trip Type","home.date":"Date","home.persons":"Persons","home.person":"Person",
    "home.search":"Search Trips","home.searching":"Searching...","home.loading":"Loading trips...",
    "home.verified":"Verified operators","home.verifiedSub":"Approved SeaGo partners",
    "home.pricing":"Clear pricing","home.pricingSub":"No hidden fees",
    "home.ticket":"Instant ticket","home.ticketSub":"After payment",
    "home.curated":"CURATED FOR YOU","home.popular":"Popular Sea Experiences",
    "home.popularSub":"Trusted trips picked for an easy day on the Red Sea.","home.seeAll":"See all",
    "menu.eyebrow":"EXPLORE AQABA","menu.home":"Home","menu.experiences":"Sea Experiences",
    "menu.tickets":"My Tickets","menu.favourites":"Favourites","menu.alerts":"Alerts","menu.profile":"Profile",
    "menu.language":"Language","menu.switch":"العربية","menu.footer":"Aqaba SeaGo · Red Sea experiences",
    "nav.home":"Home","nav.trips":"Trips","nav.tickets":"Tickets","nav.alerts":"Alerts","nav.profile":"Profile",
    "trip.verified":"Verified operator","trip.from":"From","trip.perAdult":"per adult","trip.view":"View experience",
    "trip.noDepartures":"No departures available","trip.next":"Next","trip.seats":"seats"
  },
  ar:{
    "home.hero.eyebrow":"اهرب · استكشف · اصنع ذكرى",
    "home.hero.title":"خلّي العقبة ذكرى ما بتنتسى",
    "home.hero.subtitle":"ذكرتك الجاية على البحر الأحمر بتبدأ من هون.",
    "home.tripType":"نوع الرحلة","home.date":"التاريخ","home.persons":"الأشخاص","home.person":"شخص",
    "home.search":"ابحث عن رحلات","home.searching":"جاري البحث...","home.loading":"جاري تحميل الرحلات...",
    "home.verified":"مشغّلون موثوقون","home.verifiedSub":"شركاء معتمدون لدى SeaGo",
    "home.pricing":"أسعار واضحة","home.pricingSub":"بدون رسوم مخفية",
    "home.ticket":"تذكرة فورية","home.ticketSub":"بعد تأكيد الدفع",
    "home.curated":"مختارة إلك","home.popular":"أشهر التجارب البحرية",
    "home.popularSub":"رحلات موثوقة ليوم سهل وممتع على البحر الأحمر.","home.seeAll":"عرض الكل",
    "menu.eyebrow":"اكتشف العقبة","menu.home":"الرئيسية","menu.experiences":"التجارب البحرية",
    "menu.tickets":"تذاكري","menu.favourites":"المفضلة","menu.alerts":"التنبيهات","menu.profile":"حسابي",
    "menu.language":"اللغة","menu.switch":"English","menu.footer":"Aqaba SeaGo · تجارب البحر الأحمر",
    "nav.home":"الرئيسية","nav.trips":"الرحلات","nav.tickets":"التذاكر","nav.alerts":"التنبيهات","nav.profile":"حسابي",
    "trip.verified":"مشغّل موثوق","trip.from":"ابتداءً من","trip.perAdult":"للبالغ","trip.view":"عرض الرحلة",
    "trip.noDepartures":"لا توجد رحلات متاحة","trip.next":"القادمة","trip.seats":"مقاعد"
  }
};

const categoryLabels={
  en:{
    "All Trips":"All Trips","Boat Trips":"Boat Trips","Yachts":"Yachts","Snorkeling":"Snorkeling","Diving":"Diving",
    "Boat Trip":"Boat Trip","Private Boat":"Private Boat","Yacht":"Yacht","Glass Bottom":"Glass Bottom","Fishing":"Fishing",
    "Sunset":"Sunset","Private Event":"Private Event","Water Sports":"Water Sports","Semi Submarine":"Semi Submarine","Sea Experience":"Sea Experience"
  },
  ar:{
    "All Trips":"كل الرحلات","Boat Trips":"رحلات القوارب","Yachts":"اليخوت","Snorkeling":"سنوركلينغ","Diving":"الغوص",
    "Boat Trip":"رحلة قارب","Private Boat":"قارب خاص","Yacht":"يخت","Glass Bottom":"قارب زجاجي","Fishing":"صيد",
    "Sunset":"غروب الشمس","Private Event":"فعالية خاصة","Water Sports":"رياضات مائية","Semi Submarine":"شبه غواصة","Sea Experience":"تجربة بحرية"
  }
};

const LanguageContext=createContext(null);

function initialLanguage(){
  try{return localStorage.getItem("seago_language")==="ar"?"ar":"en"}catch{return "en"}
}

export function LanguageProvider({children}){
  const[language,setLanguage]=useState(initialLanguage);
  useEffect(()=>{
    try{localStorage.setItem("seago_language",language)}catch{}
    document.documentElement.lang=language;
    document.documentElement.dir=language==="ar"?"rtl":"ltr";
  },[language]);
  const value=useMemo(()=>({
    language,
    isArabic:language==="ar",
    setLanguage,
    toggleLanguage:()=>setLanguage(v=>v==="ar"?"en":"ar"),
    t:key=>translations[language]?.[key]??translations.en[key]??key,
    category:value=>categoryLabels[language]?.[value]??value
  }),[language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(){
  const ctx=useContext(LanguageContext);
  if(!ctx)throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
