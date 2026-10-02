import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";

function configured(){
  return Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY);
}

function configure(){
  if(!configured())return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT||"mailto:admin@aqabaseago.local",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

export function getVapidPublicKey(){
  return process.env.VAPID_PUBLIC_KEY||"";
}

export async function sendPushToUser(userId,{title,body,data={}}){
  if(!userId||!configure())return {sent:0,failed:0,skipped:true};
  const rows=await PushSubscription.find({userId});
  let sent=0,failed=0;
  for(const row of rows){
    try{
      await webpush.sendNotification(
        {endpoint:row.endpoint,keys:row.keys},
        JSON.stringify({title,body,data})
      );
      row.lastUsedAt=new Date();
      await row.save();
      sent++;
    }catch(e){
      failed++;
      if(e?.statusCode===404||e?.statusCode===410){
        await PushSubscription.deleteOne({_id:row._id});
      }else{
        console.error("Push send failed",e?.statusCode||"",e?.message||e);
      }
    }
  }
  return {sent,failed,skipped:false};
}
