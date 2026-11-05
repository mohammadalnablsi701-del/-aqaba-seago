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
  for(const key of ["adultPrice","childPrice"]){
    if(own(input,key)){
      const value=number(input[key],10000);
      if(value!==undefined)draft[key]=value;
    }
  }
  return draft;
}
export function mergeTripConversationDraft(current,delta){
  return {...sanitizeTripConversationDraft(current),...sanitizeTripConversationDraft(delta)};
}
export function assistantConversationContext(raw){
  return {mode:["create_trip","seats"].includes(raw?.mode)?raw.mode:"",
    draft:sanitizeTripConversationDraft(raw?.draft),
    pendingField:["title","durationMinutes","adultPrice","childPrice"].includes(raw?.pendingField)?raw.pendingField:""};
}
const fields=[
  {key:"title",question:"تمام! بنجهّز الرحلة سوا 🌊 شو بدك تسمّيها؟",choices:["رحلة غروب","رحلة سنوركلينغ","رحلة بحرية"]},
  {key:"durationMinutes",question:"حلو! كم مدة الرحلة؟",choices:["ساعة","ساعتين","3 ساعات"]},
  {key:"adultPrice",question:"كم سعر الشخص الكبير بالدينار الأردني؟",choices:["15 دينار","20 دينار","25 دينار"]},
  {key:"childPrice",question:"وكم سعر الطفل من عمر 6 إلى 12 سنة؟",choices:["10 دنانير","15 دينار","نفس سعر الكبير"]}
];
export function tripConversationStep(input,options={}){
  const draft=sanitizeTripConversationDraft(input);
  const pendingField=["title","durationMinutes","adultPrice","childPrice"].includes(options.pendingField)?options.pendingField:"";
  const completed=[Boolean(draft.titleAr||draft.titleEn),draft.durationMinutes!==undefined,draft.adultPrice!==undefined,draft.childPrice!==undefined];
  const progress=completed.filter(Boolean).length;
  const missing=completed.indexOf(false);
  if(pendingField||missing!==-1){
    const field=pendingField?fields.find(x=>x.key===pendingField):fields[missing];
    const question=pendingField?"أكيد، خلينا نعدّلها. "+field.question:field.question;
    return {draft,ready:false,progress,total:fields.length,askFor:field.key,pendingField:pendingField||"",text:question,suggestions:field.choices};
  }
  const title=draft.titleAr||draft.titleEn;
  const text="هيك جهّزنا مسودة «"+title+"» ✅\nالمدة: "+draft.durationMinutes+" دقيقة\nسعر الكبير: "+draft.adultPrice+" د.أ\nسعر الطفل: "+draft.childPrice+" د.أ\n\nافتح النموذج، وراجع المكان والصور وباقي التفاصيل قبل حفظ الرحلة. ما تم إنشاء أي شيء لحد الآن.";
  return {draft,ready:true,progress,total:fields.length,askFor:null,text,suggestions:["بدي أغيّر السعر","بدي أعدّل مدة الرحلة"]};
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
  const n=normalized(text),number=priceValue(text);
  if(inTrip&&/(?:غير|عدل|تعديل|تغيير|اغير|اعدل)/.test(n)&&!(/\d/.test(n))){
    if(/طفل/.test(n))pending="childPrice";
    else if(/مده|وقت|ساعه/.test(n))pending="durationMinutes";
    else if(/اسم/.test(n))pending="title";
    else if(/سعر|دينار/.test(n))pending="adultPrice";
    if(pending){
      const ask=tripConversationStep(draft,{pendingField:pending});
      return {intent:"create_trip",mode:"create_trip",...ask,pendingField:pending};
    }
  }
  const field=inTrip?(pending||baseStep.askFor):"";
  const explicitMinutes=minutesFromText(text,false);
  if(!inTrip){
    const title=titleFromText(text,false);
    if(title)draft.titleAr=title;
    const type=inferredCategory(text);
    if(type)draft.category=type;
    if(explicitMinutes!==undefined&&explicitMinutes>=15&&explicitMinutes<=1440)draft.durationMinutes=explicitMinutes;
    const amount=n.match(/(?:ب\s*|بسعر\s*|سعر\s*(?:الكبير|الشخص)\s*)(\d+(?:[.,]\d+)?)\s*(?:دينار|دنانير|د\.ا)/);
    if(amount)draft.adultPrice=priceValue(amount[1]);
  }else if(field==="title"){
    const title=titleFromText(text,true);
    if(title)draft.titleAr=title;
    const type=inferredCategory(text);
    if(type)draft.category=type;
  }else if(field==="durationMinutes"){
    const minutes=minutesFromText(text,true);
    if(Number.isInteger(minutes)&&minutes>=15&&minutes<=1440)draft.durationMinutes=minutes;
  }else if(field==="adultPrice"){
    if(number!==undefined)draft.adultPrice=number;
  }else if(field==="childPrice"){
    if(/نفس\s*(?:سعر|الكبير)|زي\s*(?:الكبير|سعر الكبير)/.test(n)&&draft.adultPrice!==undefined)draft.childPrice=draft.adultPrice;
    else if(number!==undefined)draft.childPrice=number;
  }else if(inTrip&&number!==undefined){
    if(/طفل/.test(n))draft.childPrice=number;
    else if(/سعر|الكبير|دينار/.test(n))draft.adultPrice=number;
  }
  // Explicitly invalid values must never be persisted or treated as complete.
  const safeDraft=sanitizeTripConversationDraft(draft);
  const next=tripConversationStep(safeDraft);
  return {intent:"create_trip",mode:"create_trip",...next,pendingField:""};
}
