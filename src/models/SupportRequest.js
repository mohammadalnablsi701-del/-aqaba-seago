import mongoose from "mongoose";

const schema=new mongoose.Schema({
  customerId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  bookingId:{type:mongoose.Schema.Types.ObjectId,ref:"Booking",index:true,sparse:true},
  subject:{type:String,trim:true,required:true},
  message:{type:String,trim:true,required:true},
  status:{type:String,enum:["open","in_progress","resolved","closed"],default:"open",index:true},
  bookingReference:{type:String,trim:true},
  resolvedAt:Date,
  resolvedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User"}
},{timestamps:true});

export default mongoose.model("SupportRequest",schema);
