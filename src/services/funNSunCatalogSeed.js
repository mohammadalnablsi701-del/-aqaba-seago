import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

export const FUN_N_SUN_TRIPS = [
  {
    titleAr: "رحلة وايت برنس للسباحة",
    titleEn: "White Prince Swimming Cruise",
    category: "yacht",
    durationMinutes: 120,
    pricing: {
      currency: "JOD",
      pricePerPerson: 15,
      adultPrice: 15,
      commissionType: "fixed_per_person",
      commissionValue: 3
    },
    departureLocation: {
      name: "Flagpole Area",
      address: "Aqaba, Jordan"
    },
    active: true
  },
  {
    titleAr: "رحلة وايت برنس المسائية",
    titleEn: "White Prince Evening Cruise",
    category: "sunset",
    durationMinutes: 120,
    pricing: {
      currency: "JOD",
      pricePerPerson: 20,
      adultPrice: 20,
      commissionType: "fixed_per_person",
      commissionValue: 5
    },
    departureLocation: {
      name: "Ayla Marina",
      address: "Aqaba, Jordan"
    },
    active: true
  },
  {
    titleAr: "تجربة كورال ويسبر ووايت برنس",
    titleEn: "Coral Whisper + White Prince Experience",
    category: "group_boat",
    durationMinutes: 180,
    pricing: {
      currency: "JOD",
      pricePerPerson: 25,
      adultPrice: 25,
      commissionType: "fixed_per_person",
      commissionValue: 5
    },
    departureLocation: {
      name: "Flagpole Area",
      address: "Aqaba, Jordan"
    },
    active: true
  }
];

export async function seedFunNSunCatalog() {
  if (process.env.SEED_FUN_N_SUN_CATALOG !== "true") return null;

  const provider = await Provider.findOne({ businessName: "Fun N Sun" });
  if (!provider) return { ok: false, skipped: "provider_not_found" };

  const created = [];
  const existing = [];

  for (const spec of FUN_N_SUN_TRIPS) {
    const found = await Trip.findOne({ providerId: provider._id, titleEn: spec.titleEn });
    if (found) {
      existing.push({ id: found._id, titleEn: found.titleEn });
      continue;
    }
    const trip = await Trip.create({ ...spec, providerId: provider._id });
    created.push({ id: trip._id, titleEn: trip.titleEn });
  }

  return {
    ok: true,
    providerId: provider._id,
    businessName: provider.businessName,
    created,
    existing
  };
}
