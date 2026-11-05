import express from "express";
import {rateLimit} from "express-rate-limit";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {requireProviderCapability} from "../services/providerAccess.js";
import {assistantConversationContext,mergeTripConversationDraft,tripConversationStep} from "../services/providerAssistantConversation.js";

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
  const context=assistantConversationContext(body.context);
  const instruction="أنت مساعد بحرّي تفاعلي لمزودي Aqaba SeaGo، افهم اللهجة الأردنية والعربية. التاريخ الحالي في الأردن "+today()+". "+ 
    "السياق الحالي الآمن (بيانات رحلة غير منشورة فقط): "+JSON.stringify(context)+". "+
    "أعد كائن JSON صحيح فقط بالحقول {intent,date,tripName,transcript,draft,reply}، بدون Markdown. "+
    "intent يجب أن يكون واحداً فقط: seats إذا المستخدم يسأل عن المقاعد والحجوزات أو الشواغر؛ create_trip إذا طلب إضافة رحلة أو تعديل مسودتها أو سأل كيف يضيف رحلة؛ cancel إذا ألغى مسودة الرحلة صراحة؛ help للأسئلة الأخرى. "+
    "إذا السياق mode=create_trip والمستخدم يعطي اسم أو مدة أو سعر أو يعدّل معلومة، استمر create_trip لا help، ما لم يطلب صراحة التحوّل للحجوزات أو الإلغاء. "+
    "إذا السياق mode=seats وقال المستخدم بكرا أو الجمعة أو اسم رحلة، استمر seats. "+
    "date تاريخ YYYY-MM-DD عند السؤال عن المقاعد، واستخرج اليوم/بكرا/تاريخ صريح وإلا فارغ. tripName اسم رحلة ذكرها المستخدم وإلا فارغ. "+
    "draft كائن يحتوي فقط على حقول الرحلة المذكورة **في الرسالة الحالية**: titleAr,titleEn,vesselName,category,durationMinutes,adultPrice,childPrice,locationName,address. "+
    "لا تنسخ القيم الموجودة بالسياق إلى draft ولا تخترع أسعاراً أو تفاصيل جديدة. يمكن استخدام سعر الكبير الموجود في السياق فقط إذا قال المستخدم صراحة إن سعر الطفل نفس سعر الكبير. "+
    "durationMinutes دقائق صحيحة، أسعار الأفراد أرقام بالدينار الأردني، والاسم العربي في titleAr. "+
    "category أحد group_boat,private_boat,yacht,glass_bottom,snorkeling,diving,fishing,sunset,private_event,water_sports,semi_submarine فقط إذا عُرف النوع. "+
    "transcript تفريغ الصوت بالعربية إذا كانت رسالة صوتية، وفارغ تماماً للنص. "+
    "reply رد عربي قصير ولطيف في حال help فقط، أجب عن خطوات استخدام واجهة المزود بالمعلومات المؤكدة التالية: الرحلة من صفحة Trips > Add trip؛ بعد الحفظ تُجدول المغادرة وتُحدد سعتها، والحجوزات من Bookings، والمقاعد من المغادرات. لا تؤكد وجود حجوزات أو مواعيد من عندك. "+
    "في إنشاء رحلة لا تدّعِ أنها نُشرت ولا تخترع بيانات. عند طلب معلومات حساسة للعملاء، وجه المستخدم إلى قسم الحجوزات المصرّح له ولا تعرض بيانات شخصية. لا تنفذ أفعالاً.";
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
  return {intent:["seats","create_trip","cancel","help"].includes(parsed.intent)?parsed.intent:"help",date:safeAssistantDate(parsed.date),tripName:clean(parsed.tripName),transcript:audio?clean(parsed.transcript,600):"",draft:safeTripDraft(parsed.draft),delta:parsed.draft&&typeof parsed.draft==="object"?parsed.draft:{},context,reply:clean(parsed.reply,600)};
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
      const info=await confirmedSeatsForProvider(access.provider._id,parsed);
      return res.json({intent:"seats",mode:"seats",transcript:parsed.transcript,...info,
        suggestions:["شو الوضع بكرا؟","كم مقعد محجوز الجمعة؟","بدي أضيف رحلة"]});
    }
    if(parsed.intent==="create_trip"){
      const access=await requireProviderCapability(req.user,"manage_trips");
      if(!access?.provider)return res.status(403).json({error:"لا تملك صلاحية إنشاء الرحلات."});
      const draft=mergeTripConversationDraft(parsed.context.mode==="create_trip"?parsed.context.draft:{},parsed.delta);
      const step=tripConversationStep(draft);
      return res.json({intent:"create_trip",mode:"create_trip",transcript:parsed.transcript,...step});
    }
    if(parsed.intent==="cancel"){
      return res.json({intent:"help",mode:"",transcript:parsed.transcript,
        text:"تمام، تركنا المسودة. ما تم إنشاء أي رحلة. تحب تسألني عن الحجوزات أو نبدأ رحلة جديدة؟",
        suggestions:["حجوزات اليوم","جهّز رحلة جديدة"]});
    }
    return res.json({intent:"help",mode:"",transcript:parsed.transcript,
      text:parsed.reply||"أنا معك! نقدر نضيف رحلة سوا خطوة بخطوة، أو أجاوبك عن المقاعد المحجوزة والمتاحة حسب التاريخ.",
      suggestions:["بدي أضيف رحلة","كم مقعد محجوز اليوم؟","شو الرحلات بكرا؟"]});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
});
export default router;
