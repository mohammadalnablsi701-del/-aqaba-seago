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
export function assistantConversationContext(raw){
  return {mode:["create_trip","seats"].includes(raw?.mode)?raw.mode:"",
    draft:sanitizeTripConversationDraft(raw?.draft),
    pendingField:tripFieldNames.includes(raw?.pendingField)?raw.pendingField:""};
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
  const questions=fields.filter(f=>draft.buffetEnabled!==false||!["buffetDescription","buffetAdultPrice","buffetChildPrice"].includes(f.key));
  const pendingField=tripFieldNames.includes(options.pendingField)?options.pendingField:"";
  const done=questions.map(f=>completedTripField(draft,f.key));
  const progress=done.filter(Boolean).length;
  const missing=done.indexOf(false);
  if(pendingField||missing!==-1){
    const field=pendingField?fields.find(f=>f.key===pendingField):questions[missing];
    return {draft,ready:false,progress,total:questions.length,askFor:field.key,pendingField:pendingField||"",
      text:(pendingField?"أكيد، خلّينا نعدّلها. ":"")+field.question,suggestions:field.choices};
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
  return {draft,ready:true,progress,total:questions.length,askFor:null,pendingField:"",
    text,suggestions:["بدي أغير البوفيه","بدي أعدل السعر","بدي أغير مكان الانطلاق"]};
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
const startTrip=s=>{
  const n=normalized(s);
  return /(?:بدي|اريد|حاب|حابب|كيف)\s*(?:اضيف|اضافه|انشئ|انشاء|اعمل|اسوي|اسويلي|جهز|ابدا)?\s*(?:لي\s*)?رحل/.test(n) ||
    /(?:اضيف|اضافه|انشئ|انشاء|جهز|اعمل|سوي|ابدا)\s*(?:لي\s*)?رحل/.test(n) ||
    /رحل[هة].*(?:جديده|جديد)/.test(n);
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
  if(inTrip&&cancellation(text))return {intent:"cancel",mode:"",text:"تمام، ألغيت مسودة الرحلة من المحادثة. ما حفظنا ولا رحلة.",suggestions:["بدي أضيف رحلة","كم مقعد محجوز اليوم؟"]};
  if(inTrip&&seatRequest(text))return null;
  if(!inTrip&&!startTrip(text))return null;
  const draft={...ctx.draft};
  const baseStep=tripConversationStep(draft,{pendingField:ctx.pendingField});
  let pending=ctx.pendingField;
  const n=normalized(text),value=priceValue(text);
  if(inTrip&&/(?:غير|عدل|تعديل|تغيير|اغير|اعدل)/.test(n)&&!(/\d/.test(n))){
    if(/بوفيه/.test(n)&&/طفل/.test(n))pending="buffetChildPrice";
    else if(/بوفيه/.test(n)&&/(?:كبير|سعر)/.test(n))pending="buffetAdultPrice";
    else if(/بوفيه/.test(n))pending="buffetEnabled";
    else if(/رابط|جوجل|ماب|خريط/.test(n))pending="googleMapsUrl";
    else if(/مكان|انطلاق|مارينا|مرسى/.test(n))pending="locationName";
    else if(/طفل/.test(n))pending="childPrice";
    else if(/مده|وقت|ساعه/.test(n))pending="durationMinutes";
    else if(/اسم/.test(n))pending="title";
    else if(/سعر|دينار/.test(n))pending="adultPrice";
    if(pending){
      const ask=tripConversationStep(draft,{pendingField:pending});
      return {intent:"create_trip",mode:"create_trip",...ask,pendingField:pending};
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
    const sameAdult=field==="childPrice"&&/نفس\s*(?:سعر|الكبير)|زي\s*(?:الكبير|سعر الكبير)/.test(n);
    const samePrice=field==="buffetAdultPrice"&&/نفس\s*سعر\s*الكبير/.test(n)?draft.adultPrice:
      field==="buffetChildPrice"&&/نفس\s*سعر\s*الطفل/.test(n)?draft.childPrice:undefined;
    const price=sameAdult?draft.adultPrice:(samePrice!==undefined?samePrice:value);
    if(price!==undefined)draft[field]=price;
  }else if(field==="buffetEnabled"){
    if(/^(?:لا|لاء|لأ|no)(?:\s|$|[،,.!])|بدون\s*بوفيه|ما\s*في\s*بوفيه|مش\s*شامل/.test(n)){
      draft.buffetEnabled=false;
      delete draft.buffetDescription;delete draft.buffetAdultPrice;delete draft.buffetChildPrice;
    }else if(/^(?:نعم|اه|ايوه|ايوا|يس|yes|اكيد)(?:\s|$|[،,.!])|مع\s*بوفيه|فيه\s*بوفيه|بوفيه\s*موجود/.test(n)){
      draft.buffetEnabled=true;
    }
  }else if(field==="buffetDescription"){
    if(n.length>=3&&!/^(?:لا|نعم|اه|تخطي|skip)$/.test(n))draft.buffetDescription=text.trim().slice(0,500);
  }else if(field==="locationName"){
    if(n.length>=2&&!/^(?:تخطي|مش عارف|لا اعرف)$/.test(n)&&!/^https?:\/\//.test(text.trim()))draft.locationName=text.trim().slice(0,120);
  }else if(field==="googleMapsUrl"){
    if(/^(?:تخطي|تجاوز|ما عندي|لاحقا|بعدين|مش متوفر)/.test(n)){
      draft.googleMapsSkipped=true;delete draft.googleMapsUrl;
    }else{
      const candidate=text.trim().match(/https:\/\/[^\s<>"']+/i)?.[0]||text.trim();
      const url=safeGoogleMapsUrl(candidate);
      if(url){draft.googleMapsUrl=url;delete draft.googleMapsSkipped;}
    }
  }
  const next=tripConversationStep(sanitizeTripConversationDraft(draft));
  // A bad URL never silently completes the question; offer a clear correction.
  if(field==="googleMapsUrl"&&!draft.googleMapsUrl&&!draft.googleMapsSkipped&&!next.ready){
    next.text="الرابط لازم يكون رابط Google Maps صحيح (مثل maps.app.goo.gl). ابعثه أو اضغط «تخطي الرابط».";
  }
  return {intent:"create_trip",mode:"create_trip",...next,pendingField:""};
}
