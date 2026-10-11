import "dotenv/config";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDb, initializeNativePushLifecycleIndexes } from "./config/db.js";
import { validateJwtSecurity } from "./config/security.js";
import { createApp } from "./app.js";
import { releaseExpiredCheckoutHolds } from "./services/payments.js";
import { processUpcomingReminders } from "./services/notifications.js";

function validateStartupEnvironment(env){
  const port=Number(env.PORT||4000);
  if(!env.MONGODB_URI)throw new Error("MONGODB_URI is required");
  const {expiry:jwtExpiry}=validateJwtSecurity(env);
  if(!env.JWT_EXPIRES_IN)env.JWT_EXPIRES_IN=jwtExpiry;

  const publicLaunch=env.PUBLIC_LAUNCH==="true";
  const isProduction=env.NODE_ENV==="production";

  if(publicLaunch&&env.SEED_DEMO_DATA==="true"){
    throw new Error("SEED_DEMO_DATA must be false when PUBLIC_LAUNCH=true");
  }
  if(publicLaunch&&env.ENABLE_MOCK_CHECKOUT==="true"){
    throw new Error("ENABLE_MOCK_CHECKOUT must be false when PUBLIC_LAUNCH=true");
  }
  if(publicLaunch&&(env.PAYMENT_PROVIDER||"mock")==="mock"){
    throw new Error("A real payment provider is required before PUBLIC_LAUNCH=true");
  }

  // These legacy development flags are intentionally unsupported by the normal
  // server startup path. Fail loudly in production if stale configuration remains.
  if(isProduction){
    const deprecatedStartupFlags=[];
    if(env.SEED_DEMO_DATA==="true") deprecatedStartupFlags.push("SEED_DEMO_DATA");
    if(env.CLEANUP_DEMO_ON_START==="true") deprecatedStartupFlags.push("CLEANUP_DEMO_ON_START");
    if(env.RUN_PILOT_E2E_ON_START==="true") deprecatedStartupFlags.push("RUN_PILOT_E2E_ON_START");
    if(String(env.EMAIL_TEST_RECIPIENT||"").trim()) deprecatedStartupFlags.push("EMAIL_TEST_RECIPIENT");
    if(deprecatedStartupFlags.length){
      throw new Error(`Deprecated development startup flags are not allowed in production: ${deprecatedStartupFlags.join(", ")}`);
    }
  }
  return {port,publicLaunch};
}

function installShutdownHandlers(server,{logger=console}={}){
  let shuttingDown=false;
  async function shutdown(signal){
    if(shuttingDown)return;
    shuttingDown=true;
    logger.log(`${signal} received. Shutting down Aqaba SeaGo API...`);

    const forceTimer=setTimeout(()=>{
      logger.error("Graceful shutdown timed out");
      process.exit(1);
    },10000);
    forceTimer.unref();

    server.close(async err=>{
      try{
        if(err)logger.error("HTTP server close failed");
        await mongoose.connection.close();
        clearTimeout(forceTimer);
        process.exit(err?1:0);
      }catch{
        logger.error("Database close failed");
        process.exit(1);
      }
    });
  }
  process.on("SIGTERM",()=>shutdown("SIGTERM"));
  process.on("SIGINT",()=>shutdown("SIGINT"));
}

export async function bootstrapServer({
  env=process.env,
  connect=connectDb,
  initializeLifecycleIndexes=initializeNativePushLifecycleIndexes,
  appFactory=createApp,
  expireHolds=releaseExpiredCheckoutHolds,
  reminders=processUpcomingReminders,
  listen,
  scheduleJobs=true,
  installSignals=true,
  logger=console
}={}){
  const {port,publicLaunch}=validateStartupEnvironment(env);

  await connect(env.MONGODB_URI);
  // Security startup gate: no HTTP listener exists until the installation fence
  // unique index has been explicitly initialized and verified from Mongo metadata.
  await initializeLifecycleIndexes();
  await expireHolds({limit:500});

  const app=appFactory();
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

  const listenImpl=listen||((application,listenPort,onListening)=>application.listen(listenPort,onListening));
  const server=listenImpl(app,port,()=>{
    logger.log(`Aqaba SeaGo API listening on port ${port}`);
  });

  if(scheduleJobs){
    setInterval(()=>{
      expireHolds({limit:500}).catch(()=>logger.error("Expired hold cleanup failed"));
    },60000).unref();

    setInterval(()=>{
      reminders().catch(()=>logger.error("Reminder email job failed"));
    },15*60000).unref();
  }

  if(installSignals)installShutdownHandlers(server,{logger});
  return {app,server};
}

const isEntryPoint=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(isEntryPoint){
  bootstrapServer().catch(error=>{
    if(error?.code==="NATIVE_PUSH_LIFECYCLE_INDEX_NOT_READY"){
      console.error("Native push lifecycle index initialization failed");
    }else{
      console.error("Aqaba SeaGo API startup failed");
    }
    process.exit(1);
  });
}

export const serverBootstrapInternals={validateStartupEnvironment};
