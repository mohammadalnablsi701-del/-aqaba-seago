import Provider from "../models/Provider.js";
import User from "../models/User.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import CheckoutHold from "../models/CheckoutHold.js";

export async function cleanupDemoDataOnce() {
  if (process.env.CLEANUP_DEMO_ON_START !== "true") {
    return { skipped: true, reason: "disabled" };
  }
  if (process.env.SEED_DEMO_DATA === "true") {
    return { skipped: true, reason: "seed-enabled" };
  }

  const provider = await Provider.findOne({ businessName: "Aqaba SeaGo Demo Partner" });
  if (!provider) {
    return { skipped: true, reason: "no-demo-provider" };
  }

  const trips = await Trip.find({ providerId: provider._id }).select("_id");
  const tripIds = trips.map(t => t._id);
  const departures = tripIds.length
    ? await Departure.find({ tripId: { $in: tripIds } }).select("_id")
    : [];
  const departureIds = departures.map(d => d._id);

  const [bookingCount, holdCount] = await Promise.all([
    tripIds.length ? Booking.countDocuments({ tripId: { $in: tripIds } }) : 0,
    tripIds.length ? CheckoutHold.countDocuments({ tripId: { $in: tripIds } }) : 0
  ]);

  if (bookingCount > 0 || holdCount > 0) {
    return {
      skipped: true,
      reason: "history-exists",
      bookingCount,
      holdCount,
      providerId: String(provider._id)
    };
  }

  if (departureIds.length) {
    await Departure.deleteMany({ _id: { $in: departureIds } });
  }
  if (tripIds.length) {
    await Trip.deleteMany({ _id: { $in: tripIds } });
  }

  const demoProviderEmail = String(process.env.DEMO_PROVIDER_EMAIL || "").trim().toLowerCase();
  const owner = await User.findById(provider.ownerUserId).select("_id email role");
  const canDeleteOwner = Boolean(
    owner &&
    demoProviderEmail &&
    owner.email === demoProviderEmail &&
    owner.role === "provider"
  );

  await Provider.deleteOne({ _id: provider._id });

  let users = 0;
  if (canDeleteOwner) {
    const r = await User.deleteOne({ _id: owner._id });
    users = r.deletedCount || 0;
  }

  return {
    skipped: false,
    deleted: {
      provider: 1,
      trips: tripIds.length,
      departures: departureIds.length,
      users
    }
  };
}
