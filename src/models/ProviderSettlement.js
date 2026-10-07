import mongoose from "mongoose";

const providerSettlementSchema=new mongoose.Schema({
  providerId:{type:mongoose.Schema.Types.ObjectId,ref:"Provider",required:true,index:true},
  items:[{_id:false,paymentId:{type:mongoose.Schema.Types.ObjectId,ref:"Payment",required:true},bookingId:{type:mongoose.Schema.Types.ObjectId,ref:"Booking",required:true},grossSales:Number,refunds:Number,seaGoCommission:Number,providerNet:Number,amountPaid:Number}],
  paymentIds:[{type:mongoose.Schema.Types.ObjectId,ref:"Payment",required:true}],
  bookingIds:[{type:mongoose.Schema.Types.ObjectId,ref:"Booking",required:true}],
  periodFrom:{type:Date,required:true,index:true},
  periodTo:{type:Date,required:true,index:true},
  currency:{type:String,default:"JOD"},
  grossSales:{type:Number,min:0,default:0},
  refunds:{type:Number,min:0,default:0},
  seaGoCommission:{type:Number,min:0,default:0},
  providerNet:{type:Number,min:0,default:0},
  amountPaid:{type:Number,min:0,default:0},
  status:{type:String,enum:["paid"],default:"paid",index:true},
  paidAt:{type:Date,default:Date.now,index:true},
  paidBy:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},
  note:{type:String,trim:true,maxlength:500}
},{timestamps:true});

providerSettlementSchema.index({paymentIds:1},{unique:true,sparse:true});
providerSettlementSchema.index({providerId:1,paidAt:-1});

export default mongoose.model("ProviderSettlement",providerSettlementSchema);
