import mongoose from "mongoose";
const schema=new mongoose.Schema({ownerUserId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,unique:true},businessName:{type:String,required:true,trim:true},phone:{type:String,trim:true},status:{type:String,enum:["pending","approved","rejected","suspended"],default:"pending",index:true},approvedAt:Date,approvedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User"}},{timestamps:true});
export default mongoose.model("Provider",schema);
