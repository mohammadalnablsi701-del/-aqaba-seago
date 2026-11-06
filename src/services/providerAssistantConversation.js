/**
 * Provider AI conversation state is deliberately supplied by the browser per turn.
 * It is an untrusted, minimal trip draft only; never store customer records, tokens,
 * provider IDs, booking data, or conversation transcripts in this context.
 */
const categories=new Set(["group_boat","private_boat","yacht","glass_bottom","snorkeling","diving","fishing","sunset","private_event","water_sports","semi_submarine"]);
const clean=(v,max=120)=>typeof v==="string"?v.trim().replace(/\s+/g," ").slice(0,max):"";
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const number=(v,max)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):undefined;

export function sanitizeTripConversationDraft(input){
  if(!input||typeof input!=="object"||Array.isArray(input))return {};
  const draft={};
  for(const key of ["titleAr","titleEn","vesselName","locationName","address"]){
    if(own(input,key)){
      const value=clean(input[key],key==="address"?220:120);
      if(value)draft[key]=value;
    }
  }
  if(own(input,"category")&&categories.has(input.category))draft.category=input.category;
  if(own(input,"durationMinutes")){
    const value=number(input.durationMinutes,1440);
    if(Number.isInteger(value)&&value>=15)draft.durationMinutes=value;
  }
  for(const key of ["adultPrice","childPrice","buffetAdultPrice","buffetChildPrice"]){
    if(own(input,key)){
      const value=number(input[key],10000);
      if(value!==undefined)draft[key]=value;
    }
  }
  if(typeof input.buffetEnabled==="boolean")draft.buffetEnabled=input.buffetEnabled;
  if(own(input,"buffetDescription")){
    const description=clean(input.buffetDescription,500);
    if(description)draft.buffetDescription=description;
  }
  if(typeof input.googleMapsSkipped==="boolean")draft.googleMapsSkipped=input.googleMapsSkipped;
  const map=safeGoogleMapsUrl(input.googleMapsUrl);
  if(map)draft.googleMapsUrl=map;
  if(draft.buffetEnabled===false){
    delete draft.buffetDescription;
    delete draft.buffetAdultPrice;
    delete draft.buffetChildPrice;
  }
  return draft;
}
/** Only permit Google Maps HTTPS links; never use unknown shortened link hosts. */
export function safeGoogleMapsUrl(value){
  if(typeof value!=="string"||value.trim().length>500)return "";
  try{
    const url=new URL(value.trim());
    if(url.protocol!=="https:"||url.username||url.password)return "";
    const host=url.hostname.toLowerCase();
    const path=url.pathname.toLowerCase();
    const accepted=((host==="google.com"||host==="www.google.com")&&path.startsWith("/maps"))||
      (host==="maps.google.com")||
      (host==="maps.app.goo.gl"&&path.length>1)||
      (host==="goo.gl"&&path.startsWith("/maps/"));
    return accepted?url.toString():"";
  }catch{return "";}
}
export function mergeTripConversationDraft(current,delta){
  return {...sanitizeTripConversationDraft(current),...sanitizeTripConversationDraft(delta)};
}
export const tripFieldNames=["title","durationMinutes","adultPrice","childPrice","buffetEnabled","buffetDescription","buffetAdultPrice","buffetChildPrice","locationName","googleMapsUrl"];
export function safeAssistantFocus(raw){
  const intent=["seats","trip_info","trip_visibility"].includes(raw?.intent)?raw.intent:"";
  const date=typeof raw?.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(raw.date)?raw.date:"";
  return {intent,tripName:clean(raw?.tripName,80),date};
}
export function assistantConversationContext(raw){
  return {mode:["create_trip","seats"].includes(raw?.mode)?raw.mode:"",
    draft:sanitizeTripConversationDraft(raw?.draft),
    pendingField:tripFieldNames.includes(raw?.pendingField)?raw.pendingField:"",
    lang:raw?.lang==="en"?"en":"ar",
    focus:safeAssistantFocus(raw?.focus)};
}
const fields=[
  {key:"title",question:"تمام! بنجهّز الرحلة سوا 🌊 شو بدك تسمّيها؟",choices:["رحلة غروب","رحلة سنوركلينغ","رحلة بحرية"]},
  {key:"durationMinutes",question:"حلو! كم مدة الرحلة؟",choices:["ساعة","ساعتين","3 ساعات"]},
  {key:"adultPrice",question:"كم سعر الشخص الكبير بدون بوفيه بالدينار الأردني؟",choices:["15 دينار","20 دينار","25 دينار"]},
  {key:"childPrice",question:"وكم سعر الطفل بدون بوفيه من عمر 6 إلى 12 سنة؟",choices:["10 دنانير","15 دينار","نفس سعر الكبير"]},
  {key:"buffetEnabled",question:"هل الرحلة فيها بوفيه؟",choices:["نعم، مع بوفيه","لا، بدون بوفيه"]},
  {key:"buffetDescription",question:"شو بشمل البوفيه؟ اكتب وصف الأكل والمشروبات اللي بتقدمها.",choices:[]},
  {key:"buffetAdultPrice",question:"كم سعر الكبير مع البوفيه بالدينار الأردني؟",choices:["20 دينار","25 دينار","30 دينار","نفس سعر الكبير"]},
  {key:"buffetChildPrice",question:"كم سعر الطفل مع البوفيه من 6 إلى 12 سنة؟",choices:["12 دينار","15 دينار","20 دينار","نفس سعر الطفل"]},
  {key:"locationName",question:"من وين نقطة انطلاق الرحلة؟ اكتب اسم المرسى أو المكان.",choices:[]},
  {key:"googleMapsUrl",question:"ابعث رابط Google Maps لنقطة الانطلاق، أو اضغط «تخطي الرابط» وبتضيفه لاحقاً في النموذج.",choices:["تخطي الرابط"]}
];
const englishFields={
  title:{question:"Let's set up your trip 🌊 What would you like to call it?",choices:["Sunset Cruise","Snorkeling Trip","Boat Trip"]},
  durationMinutes:{question:"Great! How long is the trip?",choices:["1 hour","2 hours","3 hours"]},
  adultPrice:{question:"What is the adult price without buffet (JOD)?",choices:["15 JOD","20 JOD","25 JOD"]},
  childPrice:{question:"What is the child price without buffet, ages 6–12 (JOD)?",choices:["10 JOD","15 JOD","Same as adult"]},
  buffetEnabled:{question:"Does this trip include a buffet?",choices:["Yes, with buffet","No, without buffet"]},
  buffetDescription:{question:"What food and drinks are included in the buffet?",choices:[]},
  buffetAdultPrice:{question:"What is the adult price with buffet (JOD)?",choices:["20 JOD","25 JOD","30 JOD","Same as adult"]},
  buffetChildPrice:{question:"What is the child price with buffet, ages 6–12 (JOD)?",choices:["12 JOD","15 JOD","20 JOD","Same as child"]},
  locationName:{question:"Where does the trip depart from? Enter the marina or location.",choices:[]},
  googleMapsUrl:{question:"Send the Google Maps link for departure, or select Skip link to add it later.",choices:["Skip link"]}
};
function completedTripField(draft,key){
  switch(key){
    case "title":return Boolean(draft.titleAr||draft.titleEn);
    case "buffetEnabled":return typeof draft.buffetEnabled==="boolean";
    case "googleMapsUrl":return Boolean(draft.googleMapsUrl||draft.googleMapsSkipped===true);
    default:return key==="buffetDescription"||key==="locationName"?Boolean(draft[key]):draft[key]!==undefined;
  }
}
export function tripConversationStep(input,options={}){
  const draft=sanitizeTripConversationDraft(input);
  const lang=options.lang==="en"?"en":"ar";
  const questions=fields.filter(f=>draft.buffetEnabled===true||!["buffetDescription","buffetAdultPrice","buffetChildPrice"].includes(f.key));
  const pendingField=tripFieldNames.includes(options.pendingField)?options.pendingField:"";
  const done=questions.map(f=>completedTripField(draft,f.key));
  const progress=done.filter(Boolean).length;
  const missing=done.indexOf(false);
  if(pendingField||missing!==-1){
    const field=pendingField?fields.find(f=>f.key===pendingField):questions[missing];
    return {draft,ready:false,progress,total:questions.length,askFor:field.key,pendingField:pendingField||"",
      text:lang==="en"?(pendingField?"Sure, let’s update that. ":"")+englishFields[field.key].question:(pendingField?"أكيد، خلّينا نعدّلها. ":"")+field.question,
      suggestions:lang==="en"?englishFields[field.key].choices:field.choices};
  }
  const title=draft.titleAr||draft.titleEn;
  const buffet=draft.buffetEnabled?
    "\nالبوفيه: نعم\nشو بشمل: "+draft.buffetDescription+
    "\nسعر الكبير مع البوفيه: "+draft.buffetAdultPrice+" د.أ"+
    "\nسعر الطفل مع البوفيه: "+draft.buffetChildPrice+" د.أ":
    "\nالبوفيه: لا";
  const map=draft.googleMapsUrl||"رح تضيفه لاحقاً بالنموذج";
  const text="هيك خلّصنا مسودة «"+title+"» ✅\n"+
    "المدة: "+draft.durationMinutes+" دقيقة\n"+
    "سعر الكبير بدون بوفيه: "+draft.adultPrice+" د.أ\n"+
    "سعر الطفل بدون بوفيه: "+draft.childPrice+" د.أ"+
    buffet+"\nمكان الانطلاق: "+draft.locationName+
    "\nGoogle Maps: "+map+
    "\n\nافتح نموذج الرحلة وراجع كل التفاصيل والصور قبل الحفظ. ما تم إنشاء أي شيء لحد الآن.";
  const englishSummary="Your trip draft “"+title+"” is ready ✅\n"+
    "Duration: "+draft.durationMinutes+" minutes\n"+
    "Adult (without buffet): "+draft.adultPrice+" JOD\n"+
    "Child (without buffet): "+draft.childPrice+" JOD"+
    (draft.buffetEnabled?"\nBuffet: Yes\nIncludes: "+draft.buffetDescription+
      "\nAdult (with buffet): "+draft.buffetAdultPrice+" JOD"+
      "\nChild (with buffet): "+draft.buffetChildPrice+" JOD":"\nBuffet: No")+
    "\nDeparture: "+draft.locationName+
    "\nGoogle Maps: "+(draft.googleMapsUrl||"Add later in the form")+
    "\n\nPlease review the trip form and photos before saving. Nothing has been created yet.";
  return {draft,ready:true,progress,total:questions.length,askFor:null,pendingField:"",
    text:lang==="en"?englishSummary:text,suggestions:lang==="en"?["Change buffet","Edit price","Change departure location"]:["بدي أغير البوفيه","بدي أعدل السعر","بدي أغير مكان الانطلاق"]};
}
export function assistantSuggestionList(input){
  return Array.isArray(input)?input.filter(x=>typeof x==="string").map(x=>x.trim().slice(0,90)).filter(Boolean).slice(0,4):[];
}


// Deterministic Arabic text responses are free, fast and resilient to Gemini outages.
// Never treat client context as trusted authority; routes must check provider capability.
const arabicDigits=s=>String(s||"").replace(/[\u0660-\u0669]/g,d=>String(d.charCodeAt(0)-0x660)).replace(/[\u06f0-\u06f9]/g,d=>String(d.charCodeAt(0)-0x6f0));
const normalized=s=>arabicDigits(s).toLowerCase().replace(/[\u064b-\u065f\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/\s+/g," ").trim();
const numeric=s=>{const m=arabicDigits(s).match(/(?:^|[^\d])(\d+(?:[.,]\d+)?)(?!\d)/);return m?Number(m[1].replace(",",".")):undefined;};
const priceValue=s=>{const v=numeric(s);return Number.isFinite(v)&&v>=0&&v<=10000?v:undefined;};
function minutesFromText(s,allowBare=false){
  const n=normalized(s),value=numeric(s);
  const hours=(n.match(/(\d+(?:[.,]\d+)?)\s*(?:ساعه|ساعات|ساعتين|ساعه ونص|ساعه ونصف)/)||[])[1];
  if(hours){const num=Number(hours.replace(",","."));if(num>0&&num<=24)return Math.round(num*60+(n.includes("ونص")||n.includes("ونصف")?30:0));}
  const englishHours=n.match(/(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|hr)\b/);
  if(englishHours){const value=Number(englishHours[1].replace(",","."))*60;if(value>=15&&value<=1440)return Math.round(value);}
  if(/\b(?:one|two|three)\s+hours?\b/.test(n))return (/\bthree\b/.test(n)?3:/\btwo\b/.test(n)?2:1)*60;
  const englishMinutes=n.match(/(\d+)\s*(?:minutes?|mins?|min)\b/);
  if(englishMinutes)return Number(englishMinutes[1]);
  if(/ساعتين|ساعتان/.test(n))return 120;
  if(/ثلاث\s*ساعات|ثلاثه\s*ساعات/.test(n))return 180;
  if(/ساعه\s*ونص|ساعه\s*ونصف/.test(n))return 90;
  if(/ساعه|ساعه واحده/.test(n))return 60;
  if(/(\d+)\s*(?:دقيقه|دقائق)/.test(n))return Number(n.match(/(\d+)\s*(?:دقيقه|دقائق)/)[1]);
  if(allowBare&&value!==undefined&&value>=15&&value<=1440)return value;
  return undefined;
}
const seatRequest=s=>/(?:مقعد|مقاعد|حجوز|محجوز|شاغر|متاح|شو الوضع|مغادر)/.test(normalized(s))&&!/(?:اضيف|اضاف|انشئ|انشاء|جهز|اعمل|سوي|بدّي رحل)/.test(normalized(s));
const cancellation=s=>/(?:الغي|الغاء|الغِ|كنسل|بطل|امسح)\s*(?:الرحل|المسود|الطلب)|(?:ما\s*بدي\s*اكمل)/.test(normalized(s));
const languageSwitch=s=>{
  const n=normalized(s).replace(/[!?.،؛]+$/g,"").trim();
  // A standalone language name is a command, not a trip title or a request for Gemini.
  if(/^(?:ب?ال)?(?:انجليزي|انكليزي|english)$/.test(n))return "en";
  if(/^(?:ب?ال)?(?:عربي|عربيه|arabic)$/.test(n))return "ar";
  if(/(?:رد|جاوب|احكي|تكلم|تحدث|كمل|اكتب).*(?:بالانجليزي|بالانكليزي|english)|^(?:please\s+)?(?:reply|respond|speak|answer|continue)\s+(?:to\s+me\s+)?(?:in\s+)?english\b|^(?:in\s+)?english(?:\s+please)?$/.test(n))return "en";
  if(/(?:رد|جاوب|احكي|تكلم|تحدث|كمل|اكتب).*(?:بالعربي|بالعربيه|arabic)|^(?:please\s+)?(?:reply|respond|speak|answer|continue)\s+(?:to\s+me\s+)?(?:in\s+)?arabic\b|^(?:in\s+)?arabic(?:\s+please)?$/.test(n))return "ar";
  return "";
};
const startTrip=s=>{
  const n=normalized(s);
  return /(?:بدي|اريد|حاب|حابب|كيف)\s*(?:اضيف|اضافه|انشئ|انشاء|اعمل|اسوي|اسويلي|جهز|ابدا)?\s*(?:لي\s*)?رحل/.test(n) ||
    /(?:اضيف|اضافه|انشئ|انشاء|جهز|اعمل|سوي|ابدا)\s*(?:لي\s*)?رحل/.test(n) ||
    /رحل[هة].*(?:جديده|جديد)/.test(n) ||
    /\b(?:(?:i\s+(?:want|need|would like)\s+(?:to\s+)?)|(?:how\s+(?:do|can)\s+i\s+))?(?:add|create|make|start)\s+(?:a\s+)?(?:new\s+)?trip\b/.test(n);
};
function titleFromText(text,asAnswer){
  const raw=String(text||"").trim();
  const n=normalized(raw);
  if(asAnswer){
    if(/^(?:ما بعرف|مش متاكد|تخطي|بعدني|كيف)/.test(n))return "";
    return raw.slice(0,120);
  }
  if(/رحل[هة]\s+(?:غروب|بحري[هة]|سنوركلينغ|غوص|يخت|صيد)/.test(n)){
    const m=n.match(/رحل[هة]\s+(غروب|بحري[هة]|سنوركلينغ|غوص|يخت|صيد)/);
    return m?"رحلة "+m[1].replace(/ه$/,"ة"):"";
  }
  return "";
}
function inferredCategory(s){
  const n=normalized(s);
  if(/غروب/.test(n))return "sunset";
  if(/سنوركلينغ|سنوركل/.test(n))return "snorkeling";
  if(/يخت/.test(n))return "yacht";
  if(/غوص/.test(n))return "diving";
  if(/صيد/.test(n))return "fishing";
  return undefined;
}
/**
 * Return null for non-trip/general questions. Otherwise produce a fully
 * sanitized turn; no calls to Gemini, no database writes and no user PII.
 */
export function localGuidedTripTurn(text,rawContext){
  if(typeof text!=="string"||!text.trim()||text.length>1500)return null;
  const ctx=assistantConversationContext(rawContext);
  const inTrip=ctx.mode==="create_trip";
  const requestedLang=languageSwitch(text);
  const lang=requestedLang||(!inTrip&&/\b(?:trip|create|add)\b/.test(normalized(text))?"en":ctx.lang);
  // A language request is a control command, never the answer to the pending trip question.
  if(requestedLang){
    if(inTrip)return {intent:"create_trip",mode:"create_trip",
      ...tripConversationStep(ctx.draft,{pendingField:ctx.pendingField,lang}),lang};
    // Language changes work from an empty chat or seat-query mode, without an AI call.
    return {intent:"help",mode:ctx.mode==="seats"?"seats":"",lang,
      text:lang==="en"?"English selected. I'll reply in English. What would you like to do?":"تم اختيار العربية. رح أرد عليك بالعربي. شو بتحب نعمل؟",
      suggestions:lang==="en"?["Create a trip","Today's bookings","Available seats tomorrow"]:["بدي أضيف رحلة","حجوزات اليوم","المقاعد المتاحة بكرا"]};
  }
  if(inTrip&&cancellation(text))return {intent:"cancel",mode:"",lang,
    text:lang==="en"?"Trip draft canceled. Nothing was saved.":"تمام، ألغيت مسودة الرحلة من المحادثة. ما حفظنا ولا رحلة.",
    suggestions:lang==="en"?["Create a trip","Today's bookings"]:["بدي أضيف رحلة","كم مقعد محجوز اليوم؟"]};
  if(inTrip&&seatRequest(text))return null;
  if(!inTrip&&!startTrip(text))return null;
  const draft={...ctx.draft};
  const baseStep=tripConversationStep(draft,{pendingField:ctx.pendingField,lang});
  let pending=ctx.pendingField;
  const n=normalized(text),value=priceValue(text);
  if(inTrip&&/(?:غير|عدل|تعديل|تغيير|اغير|اعدل|change|edit|update)/.test(n)&&!(/\d/.test(n))){
    if(/بوفيه|buffet/.test(n)&&/طفل|child/.test(n))pending="buffetChildPrice";
    else if(/بوفيه|buffet/.test(n)&&/(?:كبير|سعر|adult|price)/.test(n))pending="buffetAdultPrice";
    else if(/بوفيه|buffet/.test(n))pending="buffetEnabled";
    else if(/رابط|جوجل|ماب|خريط|maps?\s*link/.test(n))pending="googleMapsUrl";
    else if(/مكان|انطلاق|مارينا|مرسى|departure|location/.test(n))pending="locationName";
    else if(/طفل|child/.test(n))pending="childPrice";
    else if(/مده|وقت|ساعه|duration/.test(n))pending="durationMinutes";
    else if(/اسم|title|name/.test(n))pending="title";
    else if(/سعر|دينار|price/.test(n))pending="adultPrice";
    if(pending){
      const ask=tripConversationStep(draft,{pendingField:pending,lang});
      return {intent:"create_trip",mode:"create_trip",...ask,pendingField:pending,lang};
    }
  }
  const field=inTrip?(pending||baseStep.askFor):"";
  if(!inTrip){
    const title=titleFromText(text,false);
    if(title)draft.titleAr=title;
    const type=inferredCategory(text);
    if(type)draft.category=type;
    const duration=minutesFromText(text,false);
    if(Number.isInteger(duration)&&duration>=15&&duration<=1440)draft.durationMinutes=duration;
    const amount=n.match(/(?:ب\s*|بسعر\s*|سعر\s*(?:الكبير|الشخص)\s*)(\d+(?:[.,]\d+)?)\s*(?:دينار|دنانير|د\.ا)/);
    if(amount)draft.adultPrice=priceValue(amount[1]);
    if(/بدون\s*بوفيه|ما\s*في\s*بوفيه/.test(n))draft.buffetEnabled=false;
    else if(/مع\s*بوفيه|فيه\s*بوفيه/.test(n))draft.buffetEnabled=true;
  }else if(field==="title"){
    const title=titleFromText(text,true);
    if(title)draft.titleAr=title;
    const type=inferredCategory(text);
    if(type)draft.category=type;
  }else if(field==="durationMinutes"){
    const minutes=minutesFromText(text,true);
    if(Number.isInteger(minutes)&&minutes>=15&&minutes<=1440)draft.durationMinutes=minutes;
  }else if(field==="adultPrice"||field==="childPrice"||field==="buffetAdultPrice"||field==="buffetChildPrice"){
    const sameAdult=field==="childPrice"&&/نفس\s*(?:سعر|الكبير)|زي\s*(?:الكبير|سعر الكبير)|same\s+(?:as\s+)?adult|same\s+price/.test(n);
    const samePrice=field==="buffetAdultPrice"&&/نفس\s*سعر\s*الكبير|same\s+(?:as\s+)?adult/.test(n)?draft.adultPrice:
      field==="buffetChildPrice"&&/نفس\s*سعر\s*الطفل|same\s+(?:as\s+)?child/.test(n)?draft.childPrice:undefined;
    const price=sameAdult?draft.adultPrice:(samePrice!==undefined?samePrice:value);
    if(price!==undefined)draft[field]=price;
  }else if(field==="buffetEnabled"){
    if(/^(?:لا|لاء|لأ|no)(?:\s|$|[،,.!])|بدون\s*بوفيه|ما\s*في\s*بوفيه|مش\s*شامل|without\s+(?:a\s+)?buffet/.test(n)){
      draft.buffetEnabled=false;
      delete draft.buffetDescription;delete draft.buffetAdultPrice;delete draft.buffetChildPrice;
    }else if(/^(?:نعم|اه|ايوه|ايوا|يس|yes|اكيد)(?:\s|$|[،,.!])|مع\s*بوفيه|فيه\s*بوفيه|بوفيه\s*موجود|with\s+(?:a\s+)?buffet/.test(n)){
      draft.buffetEnabled=true;
    }
  }else if(field==="buffetDescription"){
    if(n.length>=3&&!/^(?:لا|نعم|اه|تخطي|skip)$/.test(n))draft.buffetDescription=text.trim().slice(0,500);
  }else if(field==="locationName"){
    if(n.length>=2&&!/^(?:تخطي|مش عارف|لا اعرف)$/.test(n)&&!/^https?:\/\//.test(text.trim()))draft.locationName=text.trim().slice(0,120);
  }else if(field==="googleMapsUrl"){
    if(/^(?:تخطي|تجاوز|ما عندي|لاحقا|بعدين|مش متوفر|skip(?:\s+link)?|later|no\s+link)/.test(n)){
      draft.googleMapsSkipped=true;delete draft.googleMapsUrl;
    }else{
      const candidate=text.trim().match(/https:\/\/[^\s<>"']+/i)?.[0]||text.trim();
      const url=safeGoogleMapsUrl(candidate);
      if(url){draft.googleMapsUrl=url;delete draft.googleMapsSkipped;}
    }
  }
  const next=tripConversationStep(sanitizeTripConversationDraft(draft),{lang});
  // A bad URL never silently completes the question; offer a clear correction.
  if(field==="googleMapsUrl"&&!draft.googleMapsUrl&&!draft.googleMapsSkipped&&!next.ready){
    next.text=lang==="en"?"Please send a valid Google Maps link (for example, maps.app.goo.gl), or select Skip link.":"الرابط لازم يكون رابط Google Maps صحيح (مثل maps.app.goo.gl). ابعثه أو اضغط «تخطي الرابط».";
  }
  return {intent:"create_trip",mode:"create_trip",...next,pendingField:"",lang};
}


// Responses below are deterministic and based only on provider-scoped data supplied
// by the route after authorization. No customer records, financial commission or
// provider database rows are sent to the language model.
const formatNumber=n=>n!==null&&n!==undefined&&n!==""&&Number.isFinite(Number(n))?String(Number(n)):"—";
const titleOf=t=>clean(t?.titleAr||t?.titleEn,120)||"Trip";
const tripTerm=s=>String(s||"").toLowerCase().replace(/[\u064b-\u065f\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/\s+/g," ").trim();
export function matchAssistantTrip(trips,needle){
  const rows=Array.isArray(trips)?trips:[];
  const query=tripTerm(needle);
  if(!query)return {match:rows.length===1?rows[0]:null,options:rows.slice(0,12).map(titleOf),ambiguous:rows.length>1};
  const scored=rows.map(trip=>{
    const names=[trip.titleAr,trip.titleEn,trip.vesselName].map(tripTerm).filter(Boolean);
    const exact=names.some(x=>x===query);
    const partial=names.some(x=>x.includes(query)||query.includes(x));
    return {trip,score:exact?2:partial?1:0};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const top=scored[0]?.score||0;
  const peers=scored.filter(x=>x.score===top).map(x=>x.trip);
  return {match:peers.length===1?peers[0]:null,options:peers.slice(0,12).map(titleOf),ambiguous:peers.length>1};
}
export function assistantTripSummary(trip,lang="ar"){
  const p=trip?.pricing||{},loc=trip?.departureLocation||{};
  const adult=p.adultPrice??p.pricePerPerson,child=p.childPrice;
  const buffet=Boolean(p.buffetEnabled);
  const title=titleOf(trip);
  if(lang==="en")return "Trip: "+title+
    "\nDuration: "+formatNumber(trip?.durationMinutes)+" minutes"+
    "\nAdult price: "+formatNumber(adult)+" JOD"+
    "\nChild price: "+formatNumber(child)+" JOD"+
    "\nBuffet: "+(buffet?"Available":"Not included")+
    (buffet?"\nBuffet includes: "+(clean(p.buffetDescription,250)||"Not specified")+
      "\nAdult with buffet: "+formatNumber(p.buffetAdultPrice)+" JOD"+
      "\nChild with buffet: "+formatNumber(p.buffetChildPrice)+" JOD":"")+
    "\nDeparture location: "+(clean(loc.name,120)||"Not configured")+
    (safeGoogleMapsUrl(loc.googleMapsUrl)?"\nGoogle Maps: "+safeGoogleMapsUrl(loc.googleMapsUrl):"")+
    "\nThese details come from your company's saved trip; review them in Trips to make changes.";
  return "الرحلة: "+title+
    "\nالمدة: "+formatNumber(trip?.durationMinutes)+" دقيقة"+
    "\nسعر الكبير: "+formatNumber(adult)+" د.أ"+
    "\nسعر الطفل: "+formatNumber(child)+" د.أ"+
    "\nالبوفيه: "+(buffet?"متوفر":"غير مشمول")+
    (buffet?"\nيشمل: "+(clean(p.buffetDescription,250)||"غير محدد")+
      "\nسعر الكبير مع البوفيه: "+formatNumber(p.buffetAdultPrice)+" د.أ"+
      "\nسعر الطفل مع البوفيه: "+formatNumber(p.buffetChildPrice)+" د.أ":"")+
    "\nمكان الانطلاق: "+(clean(loc.name,120)||"غير محدد")+
    (loc.googleMapsUrl?"\nGoogle Maps: "+String(loc.googleMapsUrl).slice(0,500):"")+
    "\nهاي التفاصيل من الرحلة المحفوظة لدى شركتك. للتعديل افتح قسم الرحلات.";
}
export function assistantVisibilityDiagnosis(trip,departures,lang="ar"){
  const list=Array.isArray(departures)?departures:[];
  const reasons=[];
  if(trip?.active!==true)reasons.push(lang==="en"?"The trip is inactive.":"الرحلة غير مفعّلة.");
  if(trip?.platformStatus==="paused")reasons.push(lang==="en"?"Platform sales for this trip are paused.":"الرحلة موقوفة من إدارة المنصة.");
  const upcoming=list.filter(d=>d?.status==="scheduled"&&new Date(d.startsAt).getTime()>Date.now());
  if(!upcoming.length)reasons.push(lang==="en"?"No future scheduled departure was found.":"ما في موعد مغادرة مستقبلي مجدول.");
  else if(upcoming.every(d=>d.salesClosed===true))reasons.push(lang==="en"?"Sales are closed for all upcoming departures.":"البيع مغلق لكل المغادرات القادمة.");
  else if(upcoming.every(d=>Number(d.capacity||0)-Number(d.reservedSeats||0)<=0))
    reasons.push(lang==="en"?"Upcoming departures have no free seats; they may appear sold out.":"المغادرات القادمة ممتلئة، وقد تظهر كنفدت المقاعد.");
  if(!reasons.length)reasons.push(lang==="en"?"No obvious availability blocker was found in this trip's saved status. Check the customer date filter and refresh.":"ما ظهر مانع واضح في حالة الرحلة المسجلة. تأكد من تاريخ البحث عند العميل وحدّث الصفحة.");
  return (lang==="en"?"Availability check for ":"فحص ظهور رحلة «")+titleOf(trip)+(lang==="en"?":":"»:")+"\n"+reasons.map((x,i)=>(i+1)+". "+x).join("\n")+
    (lang==="en"?"\nThis checks saved data only; it does not guarantee search visibility.":"\nهذا فحص لبيانات النظام، وليس تأكيداً لظهور الرحلة عند كل عميل.");
}
export function assistantTroubleshooting(topic,lang="ar"){
  const ar={
    qr_checkin:"إذا مسح QR ما زبط: 1) اسمح للكاميرا من إعدادات المتصفح. 2) استخدم كاميرا الجهاز الخلفية وتأكد من وضوح الرمز. 3) افحص إن الحجز مؤكد والرحلة صحيحة وإن التذكرة ما انمسحت قبل. 4) افحص وقت المغادرة وصلاحية موظف التشييك. إذا ظهر خطأ، اكتب النص كما هو؛ ما رح أؤكد صلاحية تذكرة من غير فحص.",
    microphone:"إذا الصوت ما بيسجّل: 1) اسمح للميكروفون من إعدادات Safari أو التطبيق. 2) أغلق البرامج اللي تستخدم المايك. 3) جرّب مقطع قصير ثم دقيقة كحد أقصى. 4) إذا ظهرت رسالة حجم التسجيل أو صيغة غير مدعومة ابعث نصها. ما بقدر أغيّر صلاحيات جهازك عن بُعد.",
    login:"إذا الدخول ما زبط: تحقق من الاتصال والبيانات، وجرب استعادة كلمة المرور من صفحة الدخول. إذا ظهرت رسالة انتهاء الجلسة سجّل دخول مرة ثانية. لا تبعث كلمة مرور أو رمز تحقق في الشات.",
    booking_missing:"إذا الحجز مش ظاهر، افحص فلتر التاريخ في Bookings وحالة الدفع؛ الحجز يصير مؤكداً فقط بعد تحقق الدفع، وقد يكون قيد الدفع أو ملغياً. لا أستطيع الجزم بحالة حجز فردي بدون الرجوع للنظام المصرح.",
    payment:"الدفع غير المؤكد لا يحول الحجز إلى مؤكد. افحص حالة الدفع والحجز من الواجهة وتأكد من عدم انتهاء مهلة الحجز. لا تعيد تحصيل مبلغ أو تؤكد حجز يدوياً بدون التحقق من السجلات المخوّلة.",
    trip_save:"إذا إنشاء الرحلة أو حفظها ما زبط، تأكد من الاسم والمدة وأسعار الكبير والطفل وصور الرحلة ومكان الانطلاق. راجع رسالة التحقق عند حفظ النموذج، وانسخ نص الخطأ هنا دون بيانات عملاء.",
    seats_mismatch:"إذا عدد المقاعد مختلف، قارن الحجوزات المؤكدة مع السعة والمقاعد المحجوزة مؤقتاً للدفع. متاح الحجز = السعة ناقص المقاعد المحجوزة، بينما «مؤكد» يحسب الحجوزات المؤكدة فقط. احكيلي اسم الرحلة والتاريخ.",
    general:"احكيلي أي شاشة فيها المشكلة (الرحلات أو الحجوزات أو الماسح أو الدخول)، وشو رسالة الخطأ بالضبط، ومتى صارت. رح أساعدك نفحص السبب خطوة بخطوة، بدون تعديل بيانات مباشرة."
  };
  const en={
    qr_checkin:"If QR scanning fails: 1) Allow camera permissions. 2) Use the rear camera and a clearly visible code. 3) Check that the booking is confirmed and the ticket has not been checked in already. 4) Verify departure timing and staff permissions. Send the exact error text so I can narrow it down.",
    microphone:"If voice input fails: 1) Allow microphone permissions in Safari or the app. 2) Close apps using the microphone. 3) Try a short clip (maximum 60 seconds). 4) Send the exact upload/codec error. I cannot change your device permissions remotely.",
    login:"For sign-in issues, check your connection and credentials, use password recovery, and sign in again if the session expired. Never share passwords or verification codes here.",
    booking_missing:"Check the Bookings date filter and payment status. A booking is confirmed only after payment verification; it may still be pending payment, canceled, or expired. Do not assume a specific booking status without authorized records.",
    payment:"Unverified payments do not confirm bookings. Review the payment and booking statuses and check for expired holds. Do not collect a payment again or confirm it manually without authorized verification.",
    trip_save:"To troubleshoot saving a trip, check its title, duration, adult and child prices, required photos, and departure location. Copy the exact validation message here without any customer data.",
    seats_mismatch:"Available seats are capacity minus reserved seats (including temporary payment holds); confirmed seats count verified bookings only. Tell me the trip name and date so we can compare.",
    general:"Which screen is having the problem—Trips, Bookings, QR scanner, or sign-in? Send the exact error and when it happened. I can guide troubleshooting but will not change records without your review."
  };
  const key=Object.prototype.hasOwnProperty.call(ar,topic)?topic:"general";
  return {text:(lang==="en"?en:ar)[key],suggestions:lang==="en"?["My trips","Available seats today","QR scanning problem"]:["رحلاتي","المقاعد المتاحة اليوم","مشكلة مسح QR"],source:"guide"};
}
