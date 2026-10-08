import mongoose from "mongoose";

const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  token:{type:String,required:true,unique:true,trim:true},
  platform:{type:String,enum:["android","ios"],required:true,index:true},
  appId:{type:String,default:"com.aqabaseago.app",trim:true},
  lastUsedAt:{type:Date,default:Date.now}
},{timestamps:true});

schema.index({userId:1,updatedAt:-1});

export default mongoose.model("NativePushToken",schema);
