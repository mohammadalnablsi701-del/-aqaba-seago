import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "./config/db.js";
import { createApp } from "./app.js";
import { seedDemoData } from "./services/demoSeed.js";
import { cleanupDemoDataOnce } from "./services/demoCleanup.js";
import { releaseExpiredCheckoutHolds } from "./services/payments.js";
import { processUpcomingReminders, sendTestEmail } from "./services/notifications.js";
import { runPilotE2EOnce } from "./services/pilotE2E.js";

const port=Number(process.env.PORT||4000);
if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");

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

if(isProduction){
  const unsafeStartupFlags=[];
  if(process.env.SEED_DEMO_DATA==="true") unsafeStartupFlags.push("SEED_DEMO_DATA");
  if(process.env.CLEANUP_DEMO_ON_START==="true") unsafeStartupFlags.push("CLEANUP_DEMO_ON_START");
  if(process.env.RUN_PILOT_E2E_ON_START==="true") unsafeStartupFlags.push("RUN_PILOT_E2E_ON_START");
  if(String(process.env.EMAIL_TEST_RECIPIENT||"").trim()) unsafeStartupFlags.push("EMAIL_TEST_RECIPIENT");
  if(unsafeStartupFlags.length){
    throw new Error(`Unsafe development startup hooks are not allowed in production: ${unsafeStartupFlags.join(", ")}`);
  }
}

await connectDb(process.env.MONGODB_URI);
await seedDemoData();

const demoCleanupResult=await cleanupDemoDataOnce();
if(process.env.CLEANUP_DEMO_ON_START==="true"){
  console.log("Demo cleanup result",JSON.stringify(demoCleanupResult));
}

if(process.env.EMAIL_TEST_RECIPIENT){
  await sendTestEmail(process.env.EMAIL_TEST_RECIPIENT);
}

await releaseExpiredCheckoutHolds({limit:500});

setInterval(()=>{
  releaseExpiredCheckoutHolds({limit:500}).catch(err=>console.error("Expired hold cleanup failed",err));
},60000).unref();

setInterval(()=>{
  processUpcomingReminders().catch(err=>console.error("Reminder email job failed",err));
},15*60000).unref();

const app=createApp();

app.get("/ready",(_req,res)=>{
  const dbReady=mongoose.connection.readyState===1;
  res.status(dbReady?200:503).json({
    ok:dbReady,
    service:"aqaba-seago-api",
    database:dbReady?"ready":"not_ready",
    publicLaunch,
    demoData:process.env.SEED_DEMO_DATA==="true"
  });
});

const server=app.listen(port,async()=>{
  console.log(`Aqaba SeaGo API listening on port ${port}`);
  console.log("Pilot E2E flag",process.env.RUN_PILOT_E2E_ON_START==="true"?"enabled":"disabled");
  if(process.env.RUN_PILOT_E2E_ON_START==="true"){
    try{
      const r=await runPilotE2EOnce({port});
      console.log("Pilot E2E result",JSON.stringify(r));
    }catch(e){
      console.error("Pilot E2E failed",e?.message||e,e?.data||"");
    }
  }
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
