import express from "express";
import authRoutes from "./routes/auth.js";
import providerRoutes from "./routes/providers.js";
import adminRoutes from "./routes/admin.js";
import tripRoutes from "./routes/trips.js";
import departureRoutes from "./routes/departures.js";
import bookingRoutes from "./routes/bookings.js";
import paymentRoutes from "./routes/payments.js";
import paymentWebhookRoutes from "./routes/paymentWebhooks.js";
import mockPaymentRoutes from "./routes/mockPayments.js";

export function createApp() {
  const app = express();

  // Webhooks must receive the untouched request body for signature verification.
  app.use("/api/payments/webhooks", paymentWebhookRoutes);

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) =>
    res.json({ ok: true, service: "aqaba-seago-api", version: "0.3.0" })
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/providers", providerRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/trips", tripRoutes);
  app.use("/api/departures", departureRoutes);
  app.use("/api/bookings", bookingRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/mock-payments", mockPaymentRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "Internal server error"
    });
  });

  return app;
}
