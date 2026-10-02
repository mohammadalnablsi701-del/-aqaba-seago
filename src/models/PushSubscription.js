import mongoose from "mongoose";
const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  endpoint:{type:String,required:true,unique:true},
  keys:{
    p256dh:{type:String,required:true},
    auth:{type:String,required:true}
  },
  userAgent:String,
  lastUsedAt:Date
},{timestamps:true});
schema.index({userId:1,updatedAt:-1});
export default mongoose.model("PushSubscription",schema);
