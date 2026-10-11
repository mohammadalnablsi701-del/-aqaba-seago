import mongoose from "mongoose";

const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  appId:{type:String,required:true,trim:true},
  installationId:{type:String,required:true,trim:true},
  generation:{type:Number,required:true,min:0},
  state:{type:String,enum:["active","revoked"],required:true}
},{timestamps:true});

schema.index({appId:1,installationId:1,userId:1},{unique:true});

export default mongoose.model("NativePushLifecycle",schema);
