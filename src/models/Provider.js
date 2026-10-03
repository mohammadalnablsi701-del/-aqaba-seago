import mongoose from "mongoose";
const schema=new mongoose.Schema({
  ownerUserId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,unique:true},
  businessName:{type:String,required:true,trim:true},
  phone:{type:String,trim:true},
  status:{type:String,enum:["pending","approved","rejected","suspended"],default:"pending",index:true},
  approvedAt:Date,
  approvedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User"},
  settings:{
    defaultCapacity:{type:Number,min:1,max:500,default:20},
    defaultDepartureTime:{type:String,trim:true,default:"09:00"},
    departureLocation:{
      name:{type:String,trim:true,default:""},
      address:{type:String,trim:true,default:""},
      googleMapsUrl:{type:String,trim:true,default:""}
    }
  }
},{timestamps:true});
export default mongoose.model("Provider",schema);
