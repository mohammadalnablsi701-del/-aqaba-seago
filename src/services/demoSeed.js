import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

const DEMO_TRIPS = [
  {
    titleAr: "رحلة قارب زجاجي",
    titleEn: "Glass Bottom Boat",
    category: "glass_bottom",
    durationMinutes: 90,
    pricing: { currency: "JOD", pricePerPerson: 15, adultPrice: 15, childPrice: 10, buffetEnabled: true, buffetAdultPrice: 20, buffetChildPrice: 14, buffetDescription: "Mixed grills, fish, rice, salads, hummus and soft drinks", commissionType: "percentage", commissionValue: 0 },
    images: ["https://images.unsplash.com/photo-1530789253388-582c481c54b0?auto=format&fit=crop&w=1200&q=82","https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=82"],
    departureLocation: { name: "Aqaba Marina", address: "Aqaba, Jordan", googleMapsUrl: "https://maps.google.com/?q=Aqaba+Marina" }
  },
  {
    titleAr: "رحلة سنوركلينغ",
    titleEn: "Red Sea Snorkeling",
    category: "snorkeling",
    durationMinutes: 180,
    pricing: { currency: "JOD", pricePerPerson: 20, adultPrice: 20, childPrice: 14, buffetEnabled: true, buffetAdultPrice: 25, buffetChildPrice: 18, buffetDescription: "Grilled fish, chicken, rice, pasta, salads, hummus, bread and soft drinks", commissionType: "percentage", commissionValue: 0 },
    images: ["https://images.unsplash.com/photo-1530053969600-caed2596d242?auto=format&fit=crop&w=1200&q=82","https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=82"],
    departureLocation: { name: "Aqaba Marina", address: "Aqaba, Jordan", googleMapsUrl: "https://maps.google.com/?q=Aqaba+Marina" }
  },
  {
    titleAr: "رحلة يخت الغروب",
    titleEn: "Sunset Yacht Cruise",
    category: "sunset",
    durationMinutes: 120,
    pricing: { currency: "JOD", pricePerPerson: 25, adultPrice: 25, childPrice: 18, buffetEnabled: true, buffetAdultPrice: 30, buffetChildPrice: 22, buffetDescription: "Seafood, mixed grills, rice, salads, appetizers, desserts and soft drinks", commissionType: "percentage", commissionValue: 0 },
    images: ["https://images.unsplash.com/photo-1566847438217-76e82d383f84?auto=format&fit=crop&w=1200&q=82","https://images.unsplash.com/photo-1499403474843-04e72c14df8a?auto=format&fit=crop&w=1200&q=82"],
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

  const demoAdminEmail = String(process.env.DEMO_ADMIN_EMAIL || "").trim().toLowerCase();
  const demoAdminPassword = String(process.env.DEMO_ADMIN_PASSWORD || "");
  if (demoAdminEmail && demoAdminPassword) {
    let admin = await User.findOne({ email: demoAdminEmail });
    if (!admin) {
      admin = await User.create({
        name: "SeaGo Admin",
        email: demoAdminEmail,
        role: "admin",
        passwordHash: await bcrypt.hash(demoAdminPassword, 12),
        isActive: true
      });
    } else if (admin.role !== "admin") {
      admin.role = "admin";
      await admin.save();
    }
  }

  const demoProviderEmail = String(process.env.DEMO_PROVIDER_EMAIL || "").trim().toLowerCase();
  const demoProviderPassword = String(process.env.DEMO_PROVIDER_PASSWORD || "");
  let demoUser = null;
  if (demoProviderEmail && demoProviderPassword) {
    demoUser = await User.findOne({ email: demoProviderEmail });
    if (!demoUser) {
      demoUser = await User.create({
        name: "SeaGo Demo Provider",
        email: demoProviderEmail,
        phone: "+962790000000",
        role: "provider",
        passwordHash: await bcrypt.hash(demoProviderPassword, 12),
        isActive: true
      });
    } else if (demoUser.role !== "provider") {
      demoUser.role = "provider";
      await demoUser.save();
    }
  }

  let provider = await Provider.findOne({ businessName: "Aqaba SeaGo Demo Partner" });
  if (!provider) {
    provider = await Provider.create({
      ownerUserId: demoUser?._id || new mongoose.Types.ObjectId(),
      businessName: "Aqaba SeaGo Demo Partner",
      phone: "+962790000000",
      status: "approved",
      approvedAt: new Date()
    });
  } else if (demoUser && provider.ownerUserId.toString() !== demoUser._id.toString()) {
    provider.ownerUserId = demoUser._id;
    provider.status = "approved";
    provider.approvedAt ||= new Date();
    await provider.save();
  }

  for (const spec of DEMO_TRIPS) {
    let trip = await Trip.findOne({ providerId: provider._id, titleEn: spec.titleEn });
    if (!trip) {
      trip = await Trip.create({ ...spec, providerId: provider._id, active: true });
    } else {
      let changed = false;

      if (!trip.departureLocation?.name && spec.departureLocation) {
        trip.departureLocation = spec.departureLocation;
        changed = true;
      }

      if (trip.pricing?.adultPrice == null) {
        trip.pricing.adultPrice = spec.pricing.adultPrice;
        changed = true;
      }
      if (trip.pricing?.childPrice == null) {
        trip.pricing.childPrice = spec.pricing.childPrice;
        changed = true;
      }
      if (trip.pricing?.buffetEnabled !== true) {
        trip.pricing.buffetEnabled = true;
        changed = true;
      }
      if (trip.pricing?.buffetAdultPrice == null) {
        trip.pricing.buffetAdultPrice = spec.pricing.buffetAdultPrice;
        changed = true;
      }
      if (trip.pricing?.buffetChildPrice == null) {
        trip.pricing.buffetChildPrice = spec.pricing.buffetChildPrice;
        changed = true;
      }
      if (!trip.pricing?.buffetDescription && spec.pricing.buffetDescription) {
        trip.pricing.buffetDescription = spec.pricing.buffetDescription;
        changed = true;
      }
      if ((!Array.isArray(trip.images) || trip.images.length === 0) && Array.isArray(spec.images)) {
        trip.images = spec.images;
        changed = true;
      }
      if (trip.pricing?.commissionType !== "percentage") {
        trip.pricing.commissionType = "percentage";
        trip.pricing.commissionValue = Number(process.env.DEFAULT_COMMISSION_PERCENTAGE || 0);
        changed = true;
      }

      if (changed) await trip.save();
    }

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
