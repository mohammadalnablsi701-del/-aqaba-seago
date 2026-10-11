import mongoose from "mongoose";

export const NATIVE_PUSH_APP_ID = "com.aqabaseago.app";
export const NATIVE_PUSH_FIREBASE_PROJECT_ID = "aqaba-seago-7c92";

const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  token:{type:String,required:true,unique:true,trim:true},
  installationId:{type:String,trim:true},
  platform:{type:String,enum:["android","ios"],required:true,index:true},
  provider:{type:String,enum:["fcm","apns"],index:true},
  firebaseProjectId:{type:String,trim:true,index:true},
  appId:{type:String,default:NATIVE_PUSH_APP_ID,trim:true,index:true},
  lastUsedAt:{type:Date,default:Date.now}
},{timestamps:true});

schema.pre("validate",function(next){
  if(!this.appId)this.appId=NATIVE_PUSH_APP_ID;
  if(this.platform==="android"){
    if(!this.provider)this.provider="fcm";
    if(this.provider==="fcm"&&!this.firebaseProjectId)this.firebaseProjectId=NATIVE_PUSH_FIREBASE_PROJECT_ID;
  }else if(this.platform==="ios"&&!this.provider){
    this.provider="apns";
  }
  next();
});

schema.path("provider").validate(function(provider){
  if(!provider)return true;
  if(this.platform==="android")return provider==="fcm";
  if(this.platform==="ios")return provider==="apns";
  return false;
},"Native push provider does not match platform");

schema.path("firebaseProjectId").validate(function(projectId){
  if(this.platform!=="android"||this.provider!=="fcm")return true;
  return projectId===NATIVE_PUSH_FIREBASE_PROJECT_ID;
},"Android FCM project does not match Aqaba SeaGo");

schema.index({userId:1,updatedAt:-1});
schema.index({appId:1,installationId:1},{unique:true,sparse:true});
schema.index({userId:1,platform:1,provider:1,firebaseProjectId:1,appId:1});

export default mongoose.model("NativePushToken",schema);
