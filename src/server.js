import "dotenv/config";
import mongoose from "mongoose";
import { diagnosticReleaseReadOnlyStartup } from "./routes/productionDiagnostics.js";
import { connectDb } from "./config/db.js";
import { validateJwtSecurity } from "./config/security.js";
import { createApp } from "./app.js";
import { releaseExpiredCheckoutHolds } from "./services/payments.js";
import { processUpcomingReminders } from "./services/notifications.js";
import { applyRealPilotData } from "./services/realPilotData.js";
import { applyCommission20Migration } from "./services/commission20Migration.js";

const port=Number(process.env.PORT||4000);
if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
const {expiry:jwtExpiry}=validateJwtSecurity(process.env);
if(!process.env.JWT_EXPIRES_IN)process.env.JWT_EXPIRES_IN=jwtExpiry;

const publicLaunch=process.env.PUBLIC_LAUNCH==="true";
const isProduction=process.env.NODE_ENV==="production";

if(publicLaunch&&process.env.SEED_DEMO_DATA==="true"){
  throw new Error("SEED_DEMO_DATA must be false when PUBLIC_LAUNCH=true");
}
if(publicLaunch&&process.env.ENABLE_MOCK_CHECKOUT==="true"){
  throw new Error("ENABLE_MOCK_CHECKOUT must be false when PUBLIC_LAUNCH=true");
}
if(publicLaunch&&(process.env.PAYMENT_PROVIDER||"mock")==="mock"){
  throw new Error("A real payment provider is required before PUBLIC_LAUNCH=true");
}

// These legacy development flags are intentionally unsupported by the normal
// server startup path. Fail loudly in production if stale configuration remains.
if(isProduction){
  const deprecatedStartupFlags=[];
  if(process.env.SEED_DEMO_DATA==="true") deprecatedStartupFlags.push("SEED_DEMO_DATA");
  if(process.env.CLEANUP_DEMO_ON_START==="true") deprecatedStartupFlags.push("CLEANUP_DEMO_ON_START");
  if(process.env.RUN_PILOT_E2E_ON_START==="true") deprecatedStartupFlags.push("RUN_PILOT_E2E_ON_START");
  if(String(process.env.EMAIL_TEST_RECIPIENT||"").trim()) deprecatedStartupFlags.push("EMAIL_TEST_RECIPIENT");
  if(deprecatedStartupFlags.length){
    throw new Error(`Deprecated development startup flags are not allowed in production: ${deprecatedStartupFlags.join(", ")}`);
  }
}

// Temporary diagnostic release: no startup/index/maintenance writes, even before
// the diagnostic environment variables are configured or after they are disabled.
if (diagnosticReleaseReadOnlyStartup) {
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
} else {
await connectDb(process.env.MONGODB_URI);
await applyRealPilotData();
await applyCommission20Migration();
await releaseExpiredCheckoutHolds({limit:500});

setInterval(()=>{
  releaseExpiredCheckoutHolds({limit:500}).catch(err=>console.error("Expired hold cleanup failed",err));
},60000).unref();

setInterval(()=>{
  processUpcomingReminders().catch(err=>console.error("Reminder email job failed",err));
},15*60000).unref();

}

const app=createApp();

app.get("/ready",(_req,res)=>{
  const dbReady=mongoose.connection.readyState===1;
  res.status(dbReady?200:503).json({
    ok:dbReady,
    service:"aqaba-seago-api",
    database:dbReady?"ready":"not_ready",
    publicLaunch,
    developmentStartupHooks:false
  });
});

const server=app.listen(port,()=>{
  console.log(`Aqaba SeaGo API listening on port ${port}`);
});

let shuttingDown=false;
async function shutdown(signal){
  if(shuttingDown)return;
  shuttingDown=true;
  console.log(`${signal} received. Shutting down Aqaba SeaGo API...`);

  const forceTimer=setTimeout(()=>{
    console.error("Graceful shutdown timed out");
    process.exit(1);
  },10000);
  forceTimer.unref();

  server.close(async err=>{
    try{
      if(err)console.error("HTTP server close failed",err);
      await mongoose.connection.close();
      clearTimeout(forceTimer);
      process.exit(err?1:0);
    }catch(closeError){
      console.error("Database close failed",closeError);
      process.exit(1);
    }
  });
}

process.on("SIGTERM",()=>shutdown("SIGTERM"));
process.on("SIGINT",()=>shutdown("SIGINT"));
