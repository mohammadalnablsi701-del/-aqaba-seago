import mongoose from "mongoose";
const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  type:{type:String,required:true,index:true},
  title:{type:String,required:true,trim:true},
  body:{type:String,required:true,trim:true},
  bookingId:{type:mongoose.Schema.Types.ObjectId,ref:"Booking",index:true},
  data:{type:mongoose.Schema.Types.Mixed,default:{}},
  readAt:Date
},{timestamps:true});
schema.index({userId:1,createdAt:-1});
export default mongoose.model("InAppNotification",schema);
