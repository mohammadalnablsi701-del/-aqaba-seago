import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { rejectUnsafeRequestKeys } from "./middleware/requestSecurity.js";
import { logRequestError, publicErrorResponse } from "./utils/errorLogging.js";
import authRoutes from "./routes/auth.js";
import providerRoutes from "./routes/providers.js";
import adminRoutes from "./routes/admin.js";
import providerAccessAdminRoutes from "./routes/providerAccessAdmin.js";
import providerFeesAdminRoutes from "./routes/providerFeesAdmin.js";
import operationsRoutes from "./routes/operations.js";
import tripRoutes from "./routes/trips.js";
import departureRoutes from "./routes/departures.js";
import bookingRoutes from "./routes/bookings.js";
import paymentRoutes from "./routes/payments.js";
import paymentWebhookRoutes from "./routes/paymentWebhooks.js";
import mockPaymentRoutes from "./routes/mockPayments.js";
import ticketRoutes from "./routes/tickets.js";
import mediaRoutes from "./routes/media.js";
import notificationRoutes from "./routes/notifications.js";
import pushRoutes from "./routes/push.js";
import supportRoutes from "./routes/support.js";

function buildCorsOptions() {
  const allowed = String(process.env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  const permissiveEmptyAllowlist = process.env.NODE_ENV !== "production" && allowed.length === 0;
  const ownOrigins = new Set();
  const externalUrl = String(process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/$/, "");
  const externalHostname = String(process.env.RENDER_EXTERNAL_HOSTNAME || "").trim();
  if (externalUrl) ownOrigins.add(externalUrl);
  if (externalHostname) ownOrigins.add(`https://${externalHostname}`);
  ownOrigins.add("https://aqaba-seago-api.onrender.com");
  return {origin(origin, callback) {if (!origin || permissiveEmptyAllowlist || allowed.includes(origin) || ownOrigins.has(origin)) return callback(null, true);return callback(null, false);},credentials: false};
}

export function createApp() {
  const app = express();
  app.use("/api/payments/webhooks", paymentWebhookRoutes);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({crossOriginResourcePolicy: { policy: "cross-origin" },contentSecurityPolicy: false}));
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "1mb" }));
  app.use(rejectUnsafeRequestKeys);
  const apiLimiter=rateLimit({windowMs:15*60*1000,limit:Number(process.env.API_RATE_LIMIT||300),standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many requests. Please try again shortly."}});
  const authLimiter=rateLimit({windowMs:15*60*1000,limit:Number(process.env.AUTH_RATE_LIMIT||25),standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many sign-in attempts. Please try again later."}});
  app.use("/api",apiLimiter);
  app.use("/api/auth",authLimiter);
  app.get("/health", (_req, res) => res.json({ok:true,service:"aqaba-seago-api",version:"0.3.1",commit:process.env.RAILWAY_GIT_COMMIT_SHA||process.env.RENDER_GIT_COMMIT||process.env.GIT_COMMIT||null}));
  app.use("/api/auth", authRoutes);
  app.use("/api/providers", providerRoutes);
  app.use("/api/admin/operations", operationsRoutes);
  app.use("/api/admin", providerAccessAdminRoutes);
  app.use("/api/admin", providerFeesAdminRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/trips", tripRoutes);
  app.use("/api/departures", departureRoutes);
  app.use("/api/bookings", bookingRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/mock-payments", mockPaymentRoutes);
  app.use("/api/tickets", ticketRoutes);
  app.use("/api/media", mediaRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/push", pushRoutes);
  app.use("/api/support", supportRoutes);
  app.use((err, _req, res, _next) => {logRequestError(err);const response = publicErrorResponse(err);res.status(response.statusCode).json({ error: response.error });});
  return app;
}
