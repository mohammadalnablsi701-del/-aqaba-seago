import mongoose from "mongoose";
const schema=new mongoose.Schema({
  providerId:{type:mongoose.Schema.Types.ObjectId,ref:"Provider",required:true,index:true},
  actorUserId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  actorRole:{type:String,enum:["owner","manager","staff","checkin"],required:true},
  action:{type:String,required:true,index:true},
  targetType:{type:String,required:true},
  targetId:{type:mongoose.Schema.Types.ObjectId},
  summary:{type:String,required:true,trim:true,maxlength:220},
  metadata:{type:mongoose.Schema.Types.Mixed,default:{}}
},{timestamps:true});
schema.index({providerId:1,createdAt:-1});
export default mongoose.model("ProviderAuditLog",schema);
