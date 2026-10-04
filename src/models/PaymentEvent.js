import mongoose from "mongoose";

const schema=new mongoose.Schema({
  provider:{type:String,required:true,index:true},
  eventId:{type:String,required:true},
  externalPaymentId:{type:String,required:true,index:true},
  paymentId:{type:mongoose.Schema.Types.ObjectId,ref:"Payment",required:true,index:true},
  eventStatus:{type:String},
  amount:Number,
  currency:String,
  raw:mongoose.Schema.Types.Mixed,
  processedAt:{type:Date,default:Date.now}
},{timestamps:true});

schema.index({provider:1,eventId:1},{unique:true});

export default mongoose.model("PaymentEvent",schema);
