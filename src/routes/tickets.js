import express from "express";
import Booking from "../models/Booking.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireProviderCapability } from "../services/providerAccess.js";
import { auditProviderAction } from "../services/providerAudit.js";
import { verifyTicketToken } from "../services/tickets.js";

const router = express.Router();

async function loadTicket(token) {
  const payload = verifyTicketToken(token);
  const booking = await Booking.findById(payload.bookingId)
    .populate({ path: "tripId", select: "titleAr titleEn category durationMinutes departureLocation" })
    .populate({ path: "providerId", select: "businessName ownerUserId" })
    .populate({ path: "departureId", select: "startsAt status" });
  if (!booking) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
  return { payload, booking };
}

router.get("/validate", async (req, res, next) => {
  try {
    const { booking } = await loadTicket(req.query.token);
    const trip = booking.tripId || {};
    const provider = booking.providerId || {};
    const departure = booking.departureId || {};
    const departureUsable = departure.status === "scheduled";
    const valid = booking.status === "confirmed" && departureUsable;
    const used = Boolean(booking.checkedInAt);
    const response = {
      valid: valid && !used,
      status: booking.status,
      used,
      checkedInAt: booking.checkedInAt || null,
      bookingReference: "SG-" + String(booking._id).slice(-8).toUpperCase(),
      trip: trip.titleEn || trip.titleAr || "Aqaba Sea Experience",
      provider: provider.businessName || null,
      departureAt: departure.startsAt || null,
      guests: booking.seats
    };

    const wantsHtml = String(req.headers.accept || "").includes("text/html");
    if (!wantsHtml) return res.json(response);

    const headline = !valid ? (departure.status==="cancelled"?"Departure cancelled":"Ticket not valid") : used ? "Ticket already used" : "Valid SeaGo ticket";
    const stateClass = !valid ? "bad" : used ? "warn" : "ok";
    res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aqaba SeaGo Ticket</title>
<style>
body{margin:0;font-family:Arial,sans-serif;background:#eef7fb;color:#14324a;display:grid;min-height:100vh;place-items:center;padding:20px}
.card{width:min(420px,100%);background:white;border-radius:24px;padding:24px;box-shadow:0 20px 50px rgba(0,40,80,.14)}
.bad{color:#b42318}.warn{color:#b54708}.ok{color:#027a48}
h1{margin:8px 0 20px}.row{padding:10px 0;border-top:1px solid #edf2f6;display:flex;justify-content:space-between;gap:18px}.row span{color:#7b8a99}.row b{text-align:right}
</style></head>
<body><div class="card"><small>AQABA SEAGO · TICKET CHECK</small><h1 class="${stateClass}">${headline}</h1>
<div class="row"><span>Reference</span><b>${response.bookingReference}</b></div>
<div class="row"><span>Trip</span><b>${response.trip}</b></div>
<div class="row"><span>Provider</span><b>${response.provider || "-"}</b></div>
<div class="row"><span>Guests</span><b>${response.guests}</b></div>
<div class="row"><span>Status</span><b>${used ? "USED" : response.status.toUpperCase()}</b></div>
</div></body></html>`);
  } catch (err) { next(err); }
});

router.post("/inspect", requireAuth, requireRole("provider","admin"), async (req, res, next) => {
  try {
    const { booking } = await loadTicket(req.body.token);

    if (req.user.role === "provider") {
      const access=await requireProviderCapability(req.user,"checkin");
      const provider=access?.provider;
      if (!provider || provider._id.toString() !== booking.providerId._id.toString()) {
        return res.status(403).json({ error: "This ticket belongs to another provider" });
      }
    }

    await booking.populate({ path: "customerId", select: "name phone email" });
    const trip = booking.tripId || {};
    const provider = booking.providerId || {};
    const departure = booking.departureId || {};
    const customer = booking.customerId || {};

    const departureUsable=departure.status==="scheduled";
    res.json({
      valid: booking.status === "confirmed" && departureUsable && !booking.checkedInAt,
      status: booking.status,
      used: Boolean(booking.checkedInAt),
      checkedInAt: booking.checkedInAt || null,
      bookingReference: "SG-" + String(booking._id).slice(-8).toUpperCase(),
      trip: trip.titleEn || trip.titleAr || "Aqaba Sea Experience",
      provider: provider.businessName || null,
      departureAt: departure.startsAt || null,
      guests: booking.seats,
      adults: booking.adults,
      children: booking.children,
      mealPlan: booking.mealPlan,
      customer: {
        name: customer.name || "Guest",
        phone: customer.phone || null,
        email: customer.email || null
      }
    });
  } catch (err) { next(err); }
});

router.post("/check-in", requireAuth, requireRole("provider","admin"), async (req, res, next) => {
  try {
    const { booking } = await loadTicket(req.body.token);

    if (booking.status !== "confirmed") {
      return res.status(409).json({ error: "Ticket is not valid for check-in" });
    }
    if (!booking.departureId || booking.departureId.status !== "scheduled") {
      return res.status(409).json({ error: "Departure is not open for check-in" });
    }
    if (booking.checkedInAt) {
      return res.status(409).json({
        error: "Ticket already checked in",
        checkedInAt: booking.checkedInAt
      });
    }

    if (req.user.role === "provider") {
      const access=await requireProviderCapability(req.user,"checkin");
      const provider=access?.provider;
      if (!provider || provider._id.toString() !== booking.providerId._id.toString()) {
        return res.status(403).json({ error: "This ticket belongs to another provider" });
      }
    }

    const checkedAt=new Date();
    const claimed=await Booking.findOneAndUpdate(
      {_id:booking._id,status:"confirmed",checkedInAt:null},
      {$set:{checkedInAt:checkedAt,checkedInBy:req.user._id},$inc:{checkInCount:1}},
      {new:true}
    );
    if(!claimed)return res.status(409).json({error:"Ticket already checked in"});
    if(req.user.role==="provider"){const access=await requireProviderCapability(req.user,"checkin");if(access)await auditProviderAction({access,user:req.user,action:"booking.checkin",targetType:"booking",targetId:claimed._id,summary:"Checked in booking SG-"+String(claimed._id).slice(-8).toUpperCase(),metadata:{guests:claimed.seats}});}
    res.json({
      ok:true,
      bookingId:claimed._id,
      checkedInAt:claimed.checkedInAt,
      guests:claimed.seats
    });
  } catch (err) { next(err); }
});

export default router;
