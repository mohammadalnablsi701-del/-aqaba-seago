import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";

const DEMO_TRIPS = [
  {
    titleAr: "رحلة قارب زجاجي",
    titleEn: "Glass Bottom Boat",
    category: "glass_bottom",
    durationMinutes: 90,
    pricing: { currency: "JOD", pricePerPerson: 15, commissionType: "fixed_per_person", commissionValue: 4 },
    departureLocation: { name: "Aqaba Marina", address: "Aqaba, Jordan", googleMapsUrl: "https://maps.google.com/?q=Aqaba+Marina" }
  },
  {
    titleAr: "رحلة سنوركلينغ",
    titleEn: "Red Sea Snorkeling",
    category: "snorkeling",
    durationMinutes: 180,
    pricing: { currency: "JOD", pricePerPerson: 20, commissionType: "fixed_per_person", commissionValue: 4 },
    departureLocation: { name: "Aqaba Marina", address: "Aqaba, Jordan", googleMapsUrl: "https://maps.google.com/?q=Aqaba+Marina" }
  },
  {
    titleAr: "رحلة يخت الغروب",
    titleEn: "Sunset Yacht Cruise",
    category: "sunset",
    durationMinutes: 120,
    pricing: { currency: "JOD", pricePerPerson: 25, commissionType: "fixed_per_person", commissionValue: 4 },
    departureLocation: { name: "Aqaba Marina", address: "Aqaba, Jordan", googleMapsUrl: "https://maps.google.com/?q=Aqaba+Marina" }
  }
];

function futureStart(dayOffset, hourUtc) {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d;
}

export async function seedDemoData() {
  if (process.env.SEED_DEMO_DATA !== "true") return;

  let provider = await Provider.findOne({ businessName: "Aqaba SeaGo Demo Partner" });
  if (!provider) {
    provider = await Provider.create({
      ownerUserId: new mongoose.Types.ObjectId(),
      businessName: "Aqaba SeaGo Demo Partner",
      phone: "+962790000000",
      status: "approved",
      approvedAt: new Date()
    });
  }

  for (const spec of DEMO_TRIPS) {
    let trip = await Trip.findOne({ providerId: provider._id, titleEn: spec.titleEn });
    if (!trip) trip = await Trip.create({ ...spec, providerId: provider._id, active: true });
    else if (!trip.departureLocation?.name && spec.departureLocation) { trip.departureLocation = spec.departureLocation; await trip.save(); }

    const upcoming = await Departure.countDocuments({
      tripId: trip._id,
      status: "scheduled",
      startsAt: { $gte: new Date() }
    });

    if (upcoming === 0) {
      const hour = spec.category === "sunset" ? 15 : 7;
      await Departure.insertMany([1, 2, 3].map(dayOffset => ({
        tripId: trip._id,
        startsAt: futureStart(dayOffset, hour),
        capacity: spec.category === "sunset" ? 12 : 20,
        reservedSeats: 0,
        status: "scheduled"
      })));
    }
  }

  console.log("Demo trips and departures are ready");
}
