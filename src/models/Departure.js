import mongoose from "mongoose";
const schema=new mongoose.Schema({tripId:{type:mongoose.Schema.Types.ObjectId,ref:"Trip",required:true,index:true},startsAt:{type:Date,required:true,index:true},capacity:{type:Number,min:1,required:true},reservedSeats:{type:Number,min:0,default:0},status:{type:String,enum:["scheduled","cancelled","completed"],default:"scheduled",index:true}},{timestamps:true});
schema.index({tripId:1,startsAt:1},{unique:true});
export default mongoose.model("Departure",schema);
