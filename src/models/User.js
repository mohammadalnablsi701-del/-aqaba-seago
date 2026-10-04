import mongoose from "mongoose";
const schema=new mongoose.Schema({
  name:{type:String,required:true,trim:true},
  email:{type:String,lowercase:true,trim:true,sparse:true},
  phone:{type:String,trim:true},
  phoneNormalized:{type:String,trim:true,index:true,sparse:true},
  passwordHash:{type:String},
  googleSub:{type:String,trim:true,sparse:true},
  role:{type:String,enum:["customer","provider","admin"],default:"customer",index:true},
  isActive:{type:Boolean,default:true}
},{timestamps:true});
schema.index({email:1},{unique:true,sparse:true});
schema.index({googleSub:1},{unique:true,sparse:true});
export default mongoose.model("User",schema);
