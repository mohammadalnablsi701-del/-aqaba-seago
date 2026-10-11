import { sendPushToUser } from "./push.js";
import { sendAndroidFcmToUser } from "./nativePush.js";

async function settleChannel(name,sender,userId,payload){
  try{
    return await sender(userId,payload);
  }catch{
    return {sent:0,failed:1,skipped:false,errorCode:`${name}_channel_failed`};
  }
}

export async function sendNotificationChannelsToUser(userId,payload={},options={}){
  const webSender=options.webSender||sendPushToUser;
  const nativeSender=options.nativeSender||sendAndroidFcmToUser;
  const [webPush,nativePush]=await Promise.all([
    settleChannel("web_push",webSender,userId,payload),
    settleChannel("native_push",nativeSender,userId,payload)
  ]);
  return {webPush,nativePush};
}
