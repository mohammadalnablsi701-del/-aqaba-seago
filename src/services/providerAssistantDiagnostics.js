import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import {matchAssistantTrip,safeAssistantFocus} from "./providerAssistantConversation.js";

// Read-only formatter for provider-owned booking diagnostics.
// Inputs are aggregate counts only. No raw bookings, payments or customer data.
const codes=["pending_payment","confirmed","cancelled","expired","refunded"];
const num=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
export function normalizeAssistantBookingCounts(rows){
  const result=Object.fromEntries(codes.map(k=>[k,{bookings:0,seats:0}]));
  for(const row of Array.isArray(rows)?rows:[]){
    const key=String(row?._id||"");
    if(!Object.prototype.hasOwnProperty.call(result,key))continue;
    result[key]={bookings:num(row.bookings),seats:num(row.seats)};
  }
  return result;
}
export function formatAssistantBookingDiagnosis({date,tripName="",topic="booking_missing",
  departureCount=0,counts={},checkedIn=0,confirmedSeats=0,capacity=0,reservedSeats=0,lang="ar"}={}){
  const en=lang==="en";
  const n=Object.fromEntries(codes.map(k=>[k,num(counts?.[k]?.bookings)]));
  const place=tripName?(en?" for "+tripName:" لرحلة "+tripName):"";
  const lead=en?"Booking status check"+place+" on "+date+" (departure date):":
    "فحص حالة الحجوزات"+place+" بتاريخ "+date+" (تاريخ المغادرة):";
  const summary=en
    ?"Confirmed: "+n.confirmed+" | Pending payment: "+n.pending_payment+" | Cancelled: "+n.cancelled+" | Expired: "+n.expired+" | Refunded: "+n.refunded+"."
    :"مؤكدة: "+n.confirmed+" | قيد الدفع: "+n.pending_payment+" | ملغاة: "+n.cancelled+" | منتهية: "+n.expired+" | مستردة: "+n.refunded+".";
  const details=[];
  if(departureCount===0){
    details.push(en?"No departures are scheduled for this selected date and trip. Check the departure date and trip in Bookings.":"ما لقيت مغادرات لهذا التاريخ والرحلة. تأكد من تاريخ المغادرة واسم الرحلة في الحجوزات.");
  }else if(topic==="qr_checkin"){
    details.push(en?"Checked in: "+num(checkedIn)+" of "+n.confirmed+" confirmed bookings. This does not validate an individual QR code.":"تم تسجيل دخول "+num(checkedIn)+" من أصل "+n.confirmed+" حجز مؤكد. هذا لا يثبت صلاحية رمز QR معين.");
    details.push(en?"If QR is rejected, check camera permission, the selected departure, check-in time and exact scanner error.":"إذا رمز QR مرفوض، افحص إذن الكاميرا والمغادرة ووقت الدخول ونص رسالة الماسح.");
  }else if(topic==="seats_mismatch"){
    details.push(en?"Confirmed seats: "+num(confirmedSeats)+", reserved seats in departure inventory: "+num(reservedSeats)+", total capacity: "+num(capacity)+". Reservations can include temporary holds; these numbers are not necessarily identical.":"مقاعد مؤكدة: "+num(confirmedSeats)+"، مقاعد محجوزة في المخزون: "+num(reservedSeats)+"، السعة الإجمالية: "+num(capacity)+". المخزون قد يشمل حجز دفع مؤقت، لذلك الأرقام مش شرط تتطابق.");
    details.push(en?"Compare the selected departure in Bookings and Departures. No seat adjustments have been made.":"قارن نفس المغادرة في قسمي الحجوزات والمغادرات. ما تم تعديل أي مقعد.");
  }else{
    if(n.pending_payment>0)details.push(en?"Some bookings await payment verification and do not count as confirmed.":"بعض الحجوزات قيد الدفع، ولا تُعتبر مؤكدة قبل التحقق من الدفع.");
    details.push(en?"If a booking is missing, verify its departure date, trip, status and the screen's filters. This aggregate check cannot identify any individual's booking.":"إذا حجز معين مش ظاهر، راجع تاريخ مغادرته والرحلة وحالته وفلاتر الشاشة. هذا الفحص الإجمالي ما بحدد حجز عميل بعينه.");
  }
  return lead+"\n"+summary+"\n"+details.join("\n");
}

export async function diagnoseProviderBookings(providerId,parsed){
  const lang=parsed.context?.lang==="en"?"en":"ar",en=lang==="en";
  const topic=parsed.topic;
  const intro={intent:"troubleshoot",mode:"",lang,source:"guide",
    transcript:parsed.transcript||"",suggestions:[]};
  if(!parsed.dateProvided||!parsed.date){
    return {...intro,text:en
      ?"To check your bookings, tell me the departure date (today, tomorrow or YYYY-MM-DD) and, if possible, the trip name. Please don't share customer names or phone numbers."
      :"حتى أفحص الحجوزات من النظام، احكيلي تاريخ المغادرة (اليوم أو بكرا أو YYYY-MM-DD)، وإذا بتقدر اسم الرحلة. لا ترسل أسماء العملاء أو أرقامهم.",
      suggestions:en?["Today","Tomorrow"]:["اليوم","بكرا"],
      focus:safeAssistantFocus({intent:"troubleshoot",topic,tripName:parsed.tripName})};
  }
  const date=String(parsed.date);
  const start=new Date(date+"T00:00:00+03:00");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(start.getTime())||
    new Date(start.getTime()+10800000).toISOString().slice(0,10)!==date){
    return {...intro,text:en?"Invalid date. Provide YYYY-MM-DD.":"التاريخ غير صحيح. اكتب التاريخ بصيغة YYYY-MM-DD.",
      focus:safeAssistantFocus({intent:"troubleshoot",topic,tripName:parsed.tripName})};
  }
  const trips=await Trip.find({providerId}).select("_id titleAr titleEn vesselName").limit(101).lean();
  const focus=safeAssistantFocus({intent:"troubleshoot",topic,tripName:parsed.tripName,date});
  if(trips.length>100)return {...intro,focus,text:en
    ?"Your company has over 100 trips. Use the Bookings screen filters to narrow the search."
    :"عندك أكثر من 100 رحلة. ضيّق البحث من فلاتر الحجوزات لتجنب أرقام ناقصة."};
  const selection=matchAssistantTrip(trips,parsed.tripName);
  if(parsed.tripName&&!selection.match){
    const names=selection.options.slice(0,4);
    return {...intro,focus:safeAssistantFocus({intent:"troubleshoot",topic,date}),
      text:selection.ambiguous?(en?"Several trips match. Specify one: ":"في أكثر من رحلة مطابقة. حدد واحدة: ")+names.join("، "):
        (en?"I could not find that trip for your company. Check the name in Trips.":"ما لقيت الرحلة بهذا الاسم ضمن شركتك. راجع اسمها في قسم الرحلات."),
      suggestions:names};
  }
  const selected=parsed.tripName?[selection.match]:trips;
  const end=new Date(start.getTime()+86400000);
  const deps=await Departure.find({tripId:{$in:selected.map(t=>t._id)},startsAt:{$gte:start,$lt:end}})
    .select("_id tripId startsAt status capacity reservedSeats").limit(201).lean();
  if(deps.length>200)return {...intro,focus,text:en
    ?"Too many departures match that date. Give me a trip name to get accurate results."
    :"في مغادرات كثيرة بهذا التاريخ؛ حدد رحلة حتى ما أعطيك أرقام ناقصة."};
  const depIds=deps.map(d=>d._id),tripIds=selected.map(t=>t._id);
  const match={providerId,tripId:{$in:tripIds},departureId:{$in:depIds}};
  const grouped=depIds.length?await Booking.aggregate([
    {$match:match},{$group:{_id:"$status",bookings:{$sum:1},seats:{$sum:"$seats"}}}
  ]):[];
  const counts=normalizeAssistantBookingCounts(grouped);
  const checkedIn=depIds.length?await Booking.countDocuments({
    ...match,status:"confirmed",checkedInAt:{$type:"date"}}):0;
  const capacity=deps.reduce((n,d)=>n+Number(d.capacity||0),0);
  const reservedSeats=deps.reduce((n,d)=>n+Number(d.reservedSeats||0),0);
  const tripName=parsed.tripName?(selection.match.titleAr||selection.match.titleEn):"";
  return {...intro,source:"provider_data",focus,
    summary:{date,departures:deps.length,confirmed:counts.confirmed.bookings,
      pendingPayment:counts.pending_payment.bookings,cancelled:counts.cancelled.bookings,
      expired:counts.expired.bookings,refunded:counts.refunded.bookings},
    text:formatAssistantBookingDiagnosis({date,tripName,topic,departureCount:deps.length,
      counts,checkedIn,confirmedSeats:counts.confirmed.seats,capacity,reservedSeats,lang}),
    suggestions:en?["Check tomorrow","QR scanner issue"]:["افحص بكرا","مشكلة QR"]};
}
