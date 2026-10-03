import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "./config/db.js";
import { createApp } from "./app.js";
import { seedDemoData } from "./services/demoSeed.js";
import { releaseExpiredCheckoutHolds } from "./services/payments.js";
import { processUpcomingReminders, sendTestEmail } from "./services/notifications.js";

const port=Number(process.env.PORT||4000);
if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");

const publicLaunch=process.env.PUBLIC_LAUNCH==="true";
if(publicLaunch&&process.env.SEED_DEMO_DATA==="true"){
  throw new Error("SEED_DEMO_DATA must be false when PUBLIC_LAUNCH=true");
}
if(publicLaunch&&process.env.ENABLE_MOCK_CHECKOUT==="true"){
  throw new Error("ENABLE_MOCK_CHECKOUT must be false when PUBLIC_LAUNCH=true");
}
if(publicLaunch&&(process.env.PAYMENT_PROVIDER||"mock")==="mock"){
  throw new Error("A real payment provider is required before PUBLIC_LAUNCH=true");
}

await connectDb(process.env.MONGODB_URI);
await seedDemoData();

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

app.listen(port,()=>console.log(`Aqaba SeaGo API listening on port ${port}`));
