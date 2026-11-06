import express from "express";
import {rateLimit} from "express-rate-limit";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {requireProviderCapability,resolveProviderAccess} from "../services/providerAccess.js";
import {assistantConversationContext,mergeTripConversationDraft,tripConversationStep,localGuidedTripTurn,sanitizeTripConversationDraft,assistantTroubleshooting,matchAssistantTrip,assistantTripList,assistantTripSummary,assistantVisibilityDiagnosis,safeAssistantFocus,redactAssistantText} from "../services/providerAssistantConversation.js";

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
  const extra=sanitizeTripConversationDraft(v);
  const minutes=Number(v.durationMinutes);
  return {titleAr:clean(v.titleAr,120),titleEn:clean(v.titleEn,120),vesselName:clean(v.vesselName,120),
    category:categories.has(v.category)?v.category:"group_boat",
    durationMinutes:Number.isInteger(minutes)&&minutes>=15&&minutes<=1440?minutes:undefined,
    adultPrice:price(v.adultPrice),childPrice:price(v.childPrice),
    locationName:clean(v.locationName,120),address:clean(v.address,220),
    buffetEnabled:extra.buffetEnabled,buffetDescription:extra.buffetDescription,
    buffetAdultPrice:extra.buffetAdultPrice,buffetChildPrice:extra.buffetChildPrice,
    googleMapsUrl:extra.googleMapsUrl,googleMapsSkipped:extra.googleMapsSkipped};
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
  if(audio&&(!formats.has(mime)||audio.length>1600000||audio.length<200||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)))throw fail("صيغة أو حجم التسجيل غير مدعوم. سجّل رسالة أقصر.");
  const context=assistantConversationContext(body.context);
  const instruction=[
    "You are SeaGo Provider's intelligent assistant. Understand Jordanian Arabic, English, and speech in either language.",
    "Respond in "+(context.lang==="en"?"English":"Arabic")+". Jordan local date: "+today()+".",
    "Safe conversation context (unpublished trip draft and non-sensitive focus only): "+JSON.stringify(context)+".",
    "Return ONLY valid JSON with: intent,date,tripName,topic,transcript,draft,reply.",
    "Choose exactly one intent: seats (real confirmed/available seats or bookings counts); trip_info (saved trip prices, duration, buffet, departure location or list); trip_visibility (why a saved trip may not appear or be sellable); troubleshoot (QR/camera, mic, login, missing booking, payments, trip saving, seat mismatch); create_trip (draft creation or edits); cancel (explicit draft cancellation); help (general advice).",
    "For troubleshoot choose topic from qr_checkin,microphone,login,booking_missing,payment,trip_save,seats_mismatch,general. If focus.intent is troubleshoot and the message reports that the previous guidance failed or adds details about the same issue, retain troubleshoot and the same topic.",
    "Do NOT invent live provider data, prices, seat totals, payment statuses, diagnoses, or customer records. The server checks permissions and fetches facts after classification.",
    "tripName is ONLY an explicitly mentioned trip name; leave blank if none. date is YYYY-MM-DD for a clearly stated date, today, tomorrow or named weekday; otherwise blank.",
    "If continuing a trip draft, return create_trip when the message supplies its next field. Switch intent when user asks about real saved trips, bookings or an error instead.",
    "draft includes ONLY fields explicitly supplied in this user message: titleAr,titleEn,vesselName,category,durationMinutes,adultPrice,childPrice,buffetEnabled,buffetDescription,buffetAdultPrice,buffetChildPrice,locationName,address,googleMapsUrl.",
    "Never guess draft prices, names, buffet options or maps links. Use boolean buffetEnabled, positive durations in minutes and JOD prices. For a spoken message, transcript is an accurate short transcription in the spoken language; for text, empty string.",
    "For help, reply naturally with practical steps grounded in the app: Trips > Add trip to prepare, then schedule departures; Bookings for bookings; QR check-in for confirmed tickets. Ask for exact error and screen if uncertain. Nothing is saved without the provider opening and saving the form.",
    "No personal customer names, phone numbers, payment secrets or commissions. Never execute changes or reveal other providers' data."
  ].join(" ");
  const parts=[{text:instruction}];
  if(message)parts.push({text:redactAssistantText(message)});
  if(audio)parts.push({inlineData:{mimeType:mime==="audio/mp4"?"audio/m4a":mime,data:audio}});
  let response;
  try{response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{responseMimeType:"application/json",temperature:0,maxOutputTokens:750}}),signal:AbortSignal.timeout(audio?40000:20000)});}
  catch{throw fail("تعذّر الاتصال بالمساعد. جرّب مرة ثانية.",503);}
  if(!response.ok){
    // Status only: never log provider text/audio, response bodies or API credentials.
    console.warn("provider_assistant_upstream_error",{httpStatus:response.status});
    throw fail(response.status===429?"انتهت الحصة المجانية مؤقتاً، جرّب لاحقاً.":"خدمة المساعد غير متاحة حالياً.",response.status===429?429:503);
  }
  const json=await response.json();
  const raw=json?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
  let parsed;
  try{parsed=JSON.parse(raw.trim());}catch{throw fail("لم أفهم الطلب بشكل واضح. جرّب صياغته مرة ثانية.",422);}
  const intents=new Set(["seats","trip_info","trip_visibility","troubleshoot","create_trip","cancel","help"]);
  const intent=intents.has(parsed.intent)?parsed.intent:"help";
  const topics=new Set(["qr_checkin","microphone","login","booking_missing","payment","trip_save","seats_mismatch","general"]);
  const listRequest=/\\b(?:all\\s+trips|my\\s+trips)\\b|(?:كل\\s+الرحلات|رحلاتي)/i.test(message);
  const tripName=clean(parsed.tripName,100)||(listRequest?"":context.focus.tripName);
  const date=parsed.date?safeAssistantDate(parsed.date):(context.focus.date?safeAssistantDate(context.focus.date):safeAssistantDate(null));
  return {intent,date,tripName,topic:topics.has(parsed.topic)?parsed.topic:"general",
    transcript:audio?clean(parsed.transcript,600):"",draft:safeTripDraft(parsed.draft),
    delta:parsed.draft&&typeof parsed.draft==="object"?parsed.draft:{},context,reply:clean(parsed.reply,700)};
}
export async function confirmedSeatsForProvider(providerId,parsed){
  const date=safeAssistantDate(parsed.date),start=new Date(date+"T00:00:00+03:00");
  const lang=parsed.context?.lang==="en"?"en":"ar";
  const end=new Date(start.getTime()+86400000);
  const allTrips=await Trip.find({providerId}).select("_id titleAr titleEn vesselName").lean();
  const needle=normalize(parsed.tripName);
  const trips=needle?allTrips.filter(t=>[t.titleAr,t.titleEn,t.vesselName].some(v=>{const a=normalize(v);return a&&(a.includes(needle)||(a.length>2&&needle.includes(a)));})):allTrips;
  if(!trips.length)return {date,rows:[],text:lang==="en"?"I could not find a trip with that name for your company.":"ما لقيت رحلة بهذا الاسم عند شركتك."};
  const deps=await Departure.find({tripId:{$in:trips.map(t=>t._id)},startsAt:{$gte:start,$lt:end}}).sort({startsAt:1}).limit(50).lean();
  if(!deps.length)return {date,rows:[],text:lang==="en"?"There are no departures scheduled on "+date+".":"ما في مغادرات مسجلة بتاريخ "+date+"."};
  const counts=await Booking.aggregate([{$match:{providerId,departureId:{$in:deps.map(d=>d._id)},status:"confirmed"}},{$group:{_id:"$departureId",seats:{$sum:"$seats"},bookings:{$sum:1}}}]);
  const byTrip=new Map(trips.map(t=>[String(t._id),t])),byId=new Map(counts.map(c=>[String(c._id),c]));
  const rows=deps.map(d=>{const t=byTrip.get(String(d.tripId)),c=byId.get(String(d._id));return {trip:clean(t?.titleAr||t?.titleEn),startsAt:d.startsAt,status:d.status,confirmedSeats:Number(c?.seats||0),bookings:Number(c?.bookings||0),heldSeats:Number(d.reservedSeats||0),availableSeats:Math.max(0,Number(d.capacity||0)-Number(d.reservedSeats||0)),capacity:Number(d.capacity||0)};});
  const confirmed=rows.reduce((n,d)=>n+d.confirmedSeats,0),available=rows.reduce((n,d)=>n+d.availableSeats,0);
  return {date,rows,text:lang==="en"?"On "+date+", you have "+confirmed+" confirmed seats and "+available+" available seats across "+rows.length+" departures. Temporary payment holds may affect availability.":"بتاريخ "+date+" عندك "+confirmed+" مقعد مؤكد، و"+available+" مقعد متاح ("+rows.length+" مغادرة). المتاح قد يتأثر بحجوزات الدفع المؤقتة."};
}
router.post("/me/assistant",requireAuth,requireRole("provider"),limiter,async(req,res,next)=>{
  try{
    if(process.env.PROVIDER_AI_ENABLED!=="true")return res.status(503).json({error:"المساعد غير مُفعّل حالياً."});
    // Guided written steps run locally, even if Gemini is temporarily unavailable.
    // Check provider capability before returning any conversation state or draft.
    const local=!(req.body?.audioBase64)&&localGuidedTripTurn(req.body?.text,req.body?.context);
    if(local){
      // Language-only help is available to any authenticated provider, without granting trip/booking access.
      if(local.intent==="create_trip"||local.intent==="cancel"){
        const access=await requireProviderCapability(req.user,"manage_trips");
        if(!access?.provider)return res.status(403).json({error:"لا تملك صلاحية إنشاء الرحلات."});
      }
      return res.json(local);
    }
    const parsed=await understandAssistant(req.body||{});
    if(parsed.intent==="trip_info"||parsed.intent==="trip_visibility"){
      const access=await resolveProviderAccess(req.user);
      if(!access?.provider||!(access.capabilities.includes("manage_trips")||access.capabilities.includes("view_bookings")))
        return res.status(403).json({error:"Approved provider trip access required"});
      const rows=await Trip.find({providerId:access.provider._id})
        .select("_id titleAr titleEn vesselName category durationMinutes pricing.pricePerPerson pricing.adultPrice pricing.childPrice pricing.buffetEnabled pricing.buffetDescription pricing.buffetAdultPrice pricing.buffetChildPrice departureLocation active platformStatus")
        .sort({createdAt:-1}).limit(101).lean();
      if(!parsed.tripName&&parsed.intent==="trip_info"&&rows.length!==1)
        return res.json({intent:"trip_info",mode:"",lang:parsed.context.lang,source:"provider_data",transcript:parsed.transcript,
          text:assistantTripList(rows.slice(0,100),parsed.context.lang),
          suggestions:rows.slice(0,4).map(t=>t.titleAr||t.titleEn),focus:safeAssistantFocus({intent:"trip_info"})});
      const lang=parsed.context.lang,selection=matchAssistantTrip(rows.slice(0,100),parsed.tripName);
      if(rows.length>100&&!selection.match)return res.json({intent:parsed.intent,mode:"",lang,source:"provider_data",transcript:parsed.transcript,
        text:lang==="en"?"Please specify the exact trip name from Trips (over 100 trips found).":"اكتب اسم الرحلة المحدد من قسم Trips؛ عدد رحلاتك أكثر من 100.",
        suggestions:[],focus:safeAssistantFocus({intent:parsed.intent})});
      if(!selection.match){
        const names=selection.options;
        const msg=names.length?(lang==="en"?"Which saved trip? ":"أي رحلة محفوظة تقصد؟ ")+names.join("، "):
          (lang==="en"?"No matching trip was found for your company.":"ما لقيت رحلة بهذا الاسم محفوظة لشركتك.");
        return res.json({intent:parsed.intent,mode:"",lang,source:"provider_data",transcript:parsed.transcript,
          text:msg,suggestions:names.slice(0,4),focus:safeAssistantFocus({intent:parsed.intent})});
      }
      const trip=selection.match;
      const focus=safeAssistantFocus({intent:parsed.intent,tripName:trip.titleAr||trip.titleEn});
      if(parsed.intent==="trip_info")return res.json({intent:parsed.intent,mode:"",lang,source:"provider_data",transcript:parsed.transcript,focus,
        text:assistantTripSummary(trip,lang),suggestions:lang==="en"?["Why is this trip not visible?","Seats today"]:["ليش الرحلة مش ظاهرة؟","شو المقاعد اليوم؟"]});
      const future=await Departure.find({tripId:trip._id,startsAt:{$gt:new Date()}})
        .select("startsAt status salesClosed capacity reservedSeats").sort({startsAt:1}).limit(100).lean();
      return res.json({intent:parsed.intent,mode:"",lang,source:"provider_data",transcript:parsed.transcript,focus,
        text:assistantVisibilityDiagnosis(trip,future,lang),suggestions:lang==="en"?["Trip prices","Seats tomorrow"]:["أسعار الرحلة","المقاعد بكرا"]});
    }
    if(parsed.intent==="troubleshoot"){
      const prior=parsed.context.focus;
      const followUp=prior?.intent==="troubleshoot";
      const topic=parsed.topic==="general"&&followUp?prior.topic:parsed.topic;
      return res.json({intent:"troubleshoot",mode:"",lang:parsed.context.lang,transcript:parsed.transcript,
        focus:safeAssistantFocus({intent:"troubleshoot",topic}),
        ...assistantTroubleshooting(topic,parsed.context.lang,followUp)});
    }
    if(parsed.intent==="seats"){
      const access=await requireProviderCapability(req.user,"view_bookings");
      if(!access?.provider)return res.status(403).json({error:"لا تملك صلاحية عرض الحجوزات."});
      const info=await confirmedSeatsForProvider(access.provider._id,parsed);
      return res.json({intent:"seats",mode:"seats",lang:parsed.context.lang,source:"provider_data",transcript:parsed.transcript,...info,
        focus:safeAssistantFocus({intent:"seats",tripName:parsed.tripName,date:parsed.date}),
        suggestions:parsed.context.lang==="en"?["What about tomorrow?","Booked seats on Friday","Create a trip"]:["شو الوضع بكرا؟","كم مقعد محجوز الجمعة؟","بدي أضيف رحلة"]});
    }
    if(parsed.intent==="create_trip"){
      const access=await requireProviderCapability(req.user,"manage_trips");
      if(!access?.provider)return res.status(403).json({error:"لا تملك صلاحية إنشاء الرحلات."});
      const draft=mergeTripConversationDraft(parsed.context.mode==="create_trip"?parsed.context.draft:{},parsed.delta);
      const step=tripConversationStep(draft,{pendingField:parsed.context.pendingField,lang:parsed.context.lang});
      return res.json({intent:"create_trip",mode:"create_trip",transcript:parsed.transcript,...step,lang:parsed.context.lang});
    }
    if(parsed.intent==="cancel"){
      return res.json({intent:"help",mode:"",lang:parsed.context.lang,transcript:parsed.transcript,
        text:parsed.context.lang==="en"?"Trip draft canceled. Nothing was saved. Want to check bookings or create a new trip?":"تمام، تركنا المسودة. ما تم إنشاء أي رحلة. تحب تسألني عن الحجوزات أو نبدأ رحلة جديدة؟",
        suggestions:parsed.context.lang==="en"?["Today's bookings","Create a trip"]:["حجوزات اليوم","جهّز رحلة جديدة"]});
    }
    return res.json({intent:"help",mode:"",lang:parsed.context.lang,transcript:parsed.transcript,
      text:parsed.reply||(parsed.context.lang==="en"?"I'm here to help with trip setup, bookings, or available seats. What would you like to do?":"أنا معك! نقدر نضيف رحلة سوا خطوة بخطوة، أو أجاوبك عن المقاعد المحجوزة والمتاحة حسب التاريخ."),
      suggestions:parsed.context.lang==="en"?["Create a trip","Today's bookings","Trips tomorrow"]:["بدي أضيف رحلة","كم مقعد محجوز اليوم؟","شو الرحلات بكرا؟"]});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
});
export default router;
