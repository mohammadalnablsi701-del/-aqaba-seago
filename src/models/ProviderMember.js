import mongoose from "mongoose";
const schema=new mongoose.Schema({
  providerId:{type:mongoose.Schema.Types.ObjectId,ref:"Provider",required:true,index:true},
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  role:{type:String,enum:["manager","staff","checkin"],required:true},
  isActive:{type:Boolean,default:true,index:true},
  createdBy:{type:mongoose.Schema.Types.ObjectId,ref:"User"}
},{timestamps:true});
schema.index({providerId:1,userId:1},{unique:true});
export default mongoose.model("ProviderMember",schema);
