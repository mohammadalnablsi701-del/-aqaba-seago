import express from "express";
import {rateLimit} from "express-rate-limit";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {requireProviderCapability} from "../services/providerAccess.js";

const router=express.Router();
const categories=new Set(["group_boat","private_boat","yacht","glass_bottom","snorkeling","diving","fishing","sunset","private_event","water_sports","semi_submarine"]);
const formats=new Set(["audio/webm","audio/mp4","audio/m4a","audio/ogg","audio/mpeg","audio/mp3","audio/wav"]);
const limiter=rateLimit({windowMs:15*60*1000,limit:25,standardHeaders:"draft-8",legacyHeaders:false,keyGenerator:req=>String(req.user._id),message:{error:"وصلت للحد المؤقت لطلبات المساعد. جرّب بعد شوي."}});
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Amman",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const clean=(v,n=140)=>String(v??"").trim().replace(/\s+/g," ").slice(0,n);
const price=v=>v===undefined||v===null||v===""?undefined:(Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=10000?Number(v):undefined);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

export function safeAssistantDate(v){
  const s=String(v||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return today();
  const d=new Date(s+"T00:00:00+03:00");
  return Number.isFinite(d.getTime())&&new Date(d.getTime()+3*3600000).toISOString().slice(0,10)===s?s:today();
}
export function safeTripDraft(value){
  const v=value&&typeof value==="object"?value:{};
  const minutes=Number(v.durationMinutes);
  return {titleAr:clean(v.titleAr,120),titleEn:clean(v.titleEn,120),vesselName:clean(v.vesselName,120),
    category:categories.has(v.category)?v.category:"group_boat",
    durationMinutes:Number.isInteger(minutes)&&minutes>=15&&minutes<=1440?minutes:undefined,
    adultPrice:price(v.adultPrice),childPrice:price(v.childPrice),
    locationName:clean(v.locationName,120),address:clean(v.address,220)};
}
function normalize(v){return clean(v).toLocaleLowerCase("ar").replace(/[\u064b-\u065f]/g,"").replace(/[أإآ]/g,"ا").replace(/ة/g,"ه");}
export async function understandAssistant(body,env=process.env){
  const key=String(env.GEMINI_API_KEY||"").trim();
  if(!key)throw fail("المساعد يحتاج مفتاح Gemini المجاني على الخادم.",503);
  const model=String(env.PROVIDER_AI_MODEL||"gemini-3.5-flash-lite");
  if(!/^[a-zA-Z0-9._-]+$/.test(model))throw fail("Invalid AI model",503);
  const message=clean(body.text,1500),audio=String(body.audioBase64||"");
  const mime=clean(body.audioMimeType,80).split(";")[0];
  if(!message&&!audio)throw fail("اكتب سؤالاً أو سجّل رسالة صوتية.");
  if(audio&&(!formats.has(mime)||audio.length>650000||audio.length<200||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)))throw fail("صيغة أو حجم التسجيل غير مدعوم. سجّل رسالة أقصر.");
  const instruction="أنت مصنف أوامر لمزودي SeaGo العقبة، تفهم اللهجة الأردنية والفصحى. التاريخ في العقبة اليوم "+today()+". أعد JSON صحيح فقط بشكل {intent,date,tripName,transcript,draft}. intent أحد seats أو create_trip أو help. استفسار مقاعد أو حجوزات أو أماكن شاغرة = seats، طلب إنشاء رحلة = create_trip. date تاريخ YYYY-MM-DD، اليوم أو غداً حسب كلام المستخدم، أو فارغ. tripName اسم الرحلة المذكور وإلا فارغ. transcript تفريغ الكلام إذا كان التسجيل صوتياً وإلا فارغ. draft كائن يحوي titleAr,titleEn,vesselName,category,durationMinutes,adultPrice,childPrice,locationName,address. لا تخترع سعر أو وقت أو موقع أو قيمة مفقودة. category واحد من group_boat,private_boat,yacht,glass_bottom,snorkeling,diving,fishing,sunset,private_event,water_sports,semi_submarine. لا تنشئ أي رحلة فعلياً.";
  const parts=[{text:instruction}];
  if(message)parts.push({text:message});
  if(audio)parts.push({inlineData:{mimeType:mime==="audio/mp4"?"audio/m4a":mime,data:audio}});
  let response;
  try{response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{responseMimeType:"application/json",temperature:0,maxOutputTokens:750}}),signal:AbortSignal.timeout(20000)});}
  catch{throw fail("تعذّر الاتصال بالمساعد. جرّب مرة ثانية.",503);}
  if(!response.ok)throw fail(response.status===429?"انتهت الحصة المجانية مؤقتاً، جرّب لاحقاً.":"خدمة المساعد غير متاحة حالياً.",response.status===429?429:503);
  const json=await response.json();
  const raw=json?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
  let parsed;
  try{parsed=JSON.parse(raw.trim());}catch{throw fail("لم أفهم الطلب بشكل واضح. جرّب صياغته مرة ثانية.",422);}
  return {intent:parsed.intent,date:safeAssistantDate(parsed.date),tripName:clean(parsed.tripName),transcript:clean(parsed.transcript,600),draft:safeTripDraft(parsed.draft)};
}
export async function confirmedSeatsForProvider(providerId,parsed){
  const date=safeAssistantDate(parsed.date),start=new Date(date+"T00:00:00+03:00");
  const end=new Date(start.getTime()+86400000);
  const allTrips=await Trip.find({providerId}).select("_id titleAr titleEn vesselName").lean();
  const needle=normalize(parsed.tripName);
  const trips=needle?allTrips.filter(t=>[t.titleAr,t.titleEn,t.vesselName].some(v=>{const a=normalize(v);return a&&(a.includes(needle)||(a.length>2&&needle.includes(a)));})):allTrips;
  if(!trips.length)return {date,rows:[],text:"ما لقيت رحلة بهذا الاسم عند شركتك."};
  const deps=await Departure.find({tripId:{$in:trips.map(t=>t._id)},startsAt:{$gte:start,$lt:end}}).sort({startsAt:1}).limit(50).lean();
  if(!deps.length)return {date,rows:[],text:"ما في مغادرات مسجلة بتاريخ "+date+"."};
  const counts=await Booking.aggregate([{$match:{providerId,departureId:{$in:deps.map(d=>d._id)},status:"confirmed"}},{$group:{_id:"$departureId",seats:{$sum:"$seats"},bookings:{$sum:1}}}]);
  const byTrip=new Map(trips.map(t=>[String(t._id),t])),byId=new Map(counts.map(c=>[String(c._id),c]));
  const rows=deps.map(d=>{const t=byTrip.get(String(d.tripId)),c=byId.get(String(d._id));return {trip:clean(t?.titleAr||t?.titleEn),startsAt:d.startsAt,status:d.status,confirmedSeats:Number(c?.seats||0),bookings:Number(c?.bookings||0),heldSeats:Number(d.reservedSeats||0),availableSeats:Math.max(0,Number(d.capacity||0)-Number(d.reservedSeats||0)),capacity:Number(d.capacity||0)};});
  return {date,rows,text:"بتاريخ "+date+" عندك "+rows.reduce((n,d)=>n+d.confirmedSeats,0)+" مقعد مؤكد، و"+rows.reduce((n,d)=>n+d.availableSeats,0)+" مقعد متاح ("+rows.length+" مغادرة). المتاح قد يتأثر بحجوزات الدفع المؤقتة."};
}
router.post("/me/assistant",requireAuth,requireRole("provider"),limiter,async(req,res,next)=>{
  try{
    if(process.env.PROVIDER_AI_ENABLED!=="true")return res.status(503).json({error:"المساعد غير مُفعّل حالياً."});
    const parsed=await understandAssistant(req.body||{});
    if(parsed.intent==="seats"){
      const access=await requireProviderCapability(req.user,"view_bookings");
      if(!access?.provider)return res.status(403).json({error:"لا تملك صلاحية عرض الحجوزات."});
      return res.json({intent:"seats",transcript:parsed.transcript,...await confirmedSeatsForProvider(access.provider._id,parsed)});
    }
    if(parsed.intent==="create_trip"){
      const access=await requireProviderCapability(req.user,"manage_trips");
      if(!access?.provider)return res.status(403).json({error:"لا تملك صلاحية إنشاء الرحلات."});
      return res.json({intent:"create_trip",transcript:parsed.transcript,draft:parsed.draft,text:"جهزت لك مسودة الرحلة. افتح النموذج وراجع الاسم والأسعار والمدة قبل الحفظ؛ ما تم إنشاء أي رحلة بعد."});
    }
    return res.json({intent:"help",transcript:parsed.transcript,text:"أنا مساعد SeaGo. اسألني عن المقاعد المؤكدة والمتاحة، أو اطلب تجهيز رحلة جديدة للمراجعة."});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
});
export default router;
