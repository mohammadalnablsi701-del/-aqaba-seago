import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "./config/db.js";
import { createApp } from "./app.js";
import { runPilotE2EOnce } from "./services/pilotE2E.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging") {
  throw new Error("Pilot smoke runner is restricted to Railway staging");
}
if (process.env.ENABLE_MOCK_CHECKOUT !== "true") {
  throw new Error("ENABLE_MOCK_CHECKOUT must be true for staging smoke runner");
}
if ((process.env.PAYMENT_PROVIDER || "mock") !== "mock") {
  throw new Error("PAYMENT_PROVIDER must be mock for staging smoke runner");
}

process.env.RUN_PILOT_E2E_ON_START = "true";
process.env.PUBLIC_LAUNCH = "false";

const port = Number(process.env.PORT || 8080);
await connectDb(process.env.MONGODB_URI);
const app = createApp();
const server = app.listen(port, async () => {
  try {
    console.log(`Pilot smoke runner listening on port ${port}`);
    const result = await runPilotE2EOnce({ port });
    console.log("PILOT_SMOKE_RESULT", JSON.stringify(result));
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(result.ok ? 0 : 1);
    });
  } catch (error) {
    console.error("PILOT_SMOKE_FAILED", error);
    server.close(async () => {
      await mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
  }
});
