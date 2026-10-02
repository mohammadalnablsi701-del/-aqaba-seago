import Booking from "../models/Booking.js";
import Provider from "../models/Provider.js";
import User from "../models/User.js";
import NotificationLog from "../models/NotificationLog.js";

const APP_URL = String(process.env.FRONTEND_BASE_URL || "https://mohammadalnablsi701-del.github.io/-aqaba-seago").replace(/\/$/,"");
const FROM = process.env.EMAIL_FROM || "Aqaba SeaGo <onboarding@resend.dev>";

function fmtDate(value){
  if(!value) return "TBA";
  return new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Amman",
    weekday:"short",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"
  }).format(new Date(value));
}

function money(v,c="JOD"){return `${Number(v||0).toFixed(2)} ${c}`}

async function loadBooking(bookingId){
  return Booking.findById(bookingId)
    .populate("customerId","name email phone")
    .populate("providerId","businessName ownerUserId phone")
    .populate("tripId","titleEn titleAr category departureLocation")
    .populate("departureId","startsAt status");
}

async function sendEmail({key,bookingId,type,to,subject,html}){
  if(!to) return null;
  const existing=await NotificationLog.findOne({key});
  if(existing?.status==="sent") return existing;

  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  if(!apiKey){
    const doc=await NotificationLog.findOneAndUpdate(
      {key},
      {$set:{bookingId,type,recipient:to,status:"skipped",provider:"resend",error:"RESEND_API_KEY not configured"}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    console.log(`Email skipped (${type}) to ${to}: RESEND_API_KEY not configured`);
    return doc;
  }

  try{
    const r=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify({from:FROM,to:[to],subject,html})
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j?.message||`Email provider error ${r.status}`);
    return NotificationLog.findOneAndUpdate(
      {key},
      {$set:{bookingId,type,recipient:to,status:"sent",provider:"resend",externalId:j.id||null,error:null,sentAt:new Date()}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
  }catch(e){
    await NotificationLog.findOneAndUpdate(
      {key},
      {$set:{bookingId,type,recipient:to,status:"failed",provider:"resend",error:String(e.message||e)}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    console.error("Email send failed",type,to,e.message);
    return null;
  }
}

function shell(title,body){
  return `<!doctype html><html><body style="margin:0;background:#f4f8fb;font-family:Arial,sans-serif;color:#15364b"><div style="max-width:620px;margin:auto;padding:24px"><div style="background:#fff;border-radius:18px;padding:24px;border:1px solid #e2ebf1"><div style="font-size:22px;font-weight:800;color:#0b6fa4">Aqaba SeaGo</div><h1 style="font-size:24px;margin:18px 0 8px">${title}</h1>${body}<p style="margin-top:24px;font-size:12px;color:#7b8c99">Aqaba SeaGo · Aqaba, Jordan</p></div></div></body></html>`;
}

function bookingTable(b){
  const trip=b.tripId||{}, dep=b.departureId||{}, loc=trip.departureLocation||{};
  return `<div style="background:#f7fafc;border-radius:12px;padding:14px;margin:16px 0">
    <p><b>Booking:</b> SG-${String(b._id).slice(-8).toUpperCase()}</p>
    <p><b>Trip:</b> ${trip.titleEn||trip.titleAr||"Sea Experience"}</p>
    <p><b>Departure:</b> ${fmtDate(dep.startsAt)}</p>
    <p><b>Guests:</b> ${b.adults||0} adult(s) · ${b.children||0} child(ren)</p>
    <p><b>Package:</b> ${b.mealPlan==="with_buffet"?"Open buffet included":"Without buffet"}</p>
    <p><b>Total:</b> ${money(b.pricing?.grossAmount,b.pricing?.currency)}</p>
    ${loc.name?`<p><b>Departure point:</b> ${loc.name}${loc.address?` · ${loc.address}`:""}</p>`:""}
  </div>`;
}

export async function sendBookingConfirmation(bookingId){
  const b=await loadBooking(bookingId); if(!b) return;
  const ref=String(b._id).slice(-8).toUpperCase();
  await sendEmail({
    key:`booking-confirmed:customer:${b._id}`,
    bookingId:b._id,type:"booking_confirmed_customer",to:b.customerId?.email,
    subject:`SeaGo booking confirmed · SG-${ref}`,
    html:shell("Booking confirmed",`<p>Hi ${b.customerId?.name||"there"}, your SeaGo booking is confirmed.</p>${bookingTable(b)}<p><a href="${APP_URL}/?payment=success" style="display:inline-block;padding:12px 16px;background:#0b6fa4;color:#fff;text-decoration:none;border-radius:10px">View your ticket</a></p>`)
  });

  const provider=await Provider.findById(b.providerId?._id||b.providerId);
  const owner=provider?.ownerUserId?await User.findById(provider.ownerUserId).select("email name"):null;
  if(owner?.email){
    await sendEmail({
      key:`booking-confirmed:provider:${b._id}`,
      bookingId:b._id,type:"booking_confirmed_provider",to:owner.email,
      subject:`New SeaGo booking · SG-${ref}`,
      html:shell("New booking received",`<p>A new confirmed booking was received for ${provider.businessName}.</p>${bookingTable(b)}`)
    });
  }
}

export async function sendCancellationNotice(bookingId){
  const b=await loadBooking(bookingId); if(!b) return;
  const c=b.cancellation||{}; const ref=String(b._id).slice(-8).toUpperCase();
  await sendEmail({
    key:`booking-cancelled:customer:${b._id}:${c.cancelledAt?new Date(c.cancelledAt).getTime():"x"}`,
    bookingId:b._id,type:"booking_cancelled_customer",to:b.customerId?.email,
    subject:`SeaGo booking cancelled · SG-${ref}`,
    html:shell("Booking cancelled",`<p>Your booking has been cancelled.</p>${bookingTable(b)}<p><b>Reason:</b> ${c.reason||"Cancellation"}</p><p><b>Refund:</b> ${c.refundPercentage||0}% · ${money(c.refundAmount,b.pricing?.currency)} · ${c.refundStatus||"none"}</p>`)
  });

  const provider=await Provider.findById(b.providerId?._id||b.providerId);
  const owner=provider?.ownerUserId?await User.findById(provider.ownerUserId).select("email name"):null;
  if(owner?.email){
    await sendEmail({
      key:`booking-cancelled:provider:${b._id}:${c.cancelledAt?new Date(c.cancelledAt).getTime():"x"}`,
      bookingId:b._id,type:"booking_cancelled_provider",to:owner.email,
      subject:`SeaGo booking cancelled · SG-${ref}`,
      html:shell("Booking cancelled",`<p>A booking for ${provider.businessName} was cancelled.</p>${bookingTable(b)}<p><b>Source:</b> ${c.source||"-"}</p><p><b>Reason:</b> ${c.reason||"Cancellation"}</p>`)
    });
  }
}

export async function processUpcomingReminders(){
  const now=Date.now();
  const from=new Date(now+23*3600000);
  const to=new Date(now+25*3600000);
  const rows=await Booking.find({status:"confirmed"}).populate("departureId","startsAt");
  const due=rows.filter(b=>b.departureId?.startsAt && new Date(b.departureId.startsAt)>=from && new Date(b.departureId.startsAt)<=to);
  let sent=0;
  for(const row of due){
    const b=await loadBooking(row._id); if(!b) continue;
    const log=await sendEmail({
      key:`departure-reminder-24h:customer:${b._id}`,
      bookingId:b._id,type:"departure_reminder_24h",to:b.customerId?.email,
      subject:`SeaGo reminder · Your trip is tomorrow`,
      html:shell("Your trip is tomorrow",`<p>Hi ${b.customerId?.name||"there"}, here is your 24-hour reminder.</p>${bookingTable(b)}<p>Please arrive early enough for check-in.</p>`)
    });
    if(log?.status==="sent") sent++;
  }
  return sent;
}

export async function sendTestEmail(to){
  const recipient=String(to||"").trim();
  if(!recipient) return null;
  const log=await sendEmail({
    key:`email-test:${recipient}`,
    bookingId:null,
    type:"email_test",
    to:recipient,
    subject:"Aqaba SeaGo — Email test successful",
    html:shell("Email test successful",`<p>Your Aqaba SeaGo email delivery is configured correctly.</p><p>If you received this message, Resend and the SeaGo backend are connected successfully.</p>`)
  });
  if(log?.status==="sent") console.log("SeaGo test email sent", recipient, log.externalId||"");
  else console.log("SeaGo test email status", recipient, log?.status||"unknown", log?.error||"");
  return log;
}
