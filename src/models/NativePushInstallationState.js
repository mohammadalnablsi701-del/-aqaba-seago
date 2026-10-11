import mongoose from "mongoose";
import { NATIVE_PUSH_APP_ID } from "./NativePushToken.js";

const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  installationId:{type:String,required:true,trim:true},
  appId:{type:String,default:NATIVE_PUSH_APP_ID,required:true,trim:true,index:true},
  currentEpoch:{
    type:Number,
    required:true,
    min:1,
    validate:{validator:Number.isSafeInteger,message:"Native push lifecycle epoch must be a safe integer"}
  },
  active:{type:Boolean,default:false,required:true,index:true},
  lastSubscribedAt:{type:Date},
  revokedAt:{type:Date}
},{timestamps:true});

schema.index({appId:1,installationId:1},{unique:true});
schema.index({userId:1,updatedAt:-1});

export default mongoose.model("NativePushInstallationState",schema);
