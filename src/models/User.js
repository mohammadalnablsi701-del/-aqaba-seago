import mongoose from "mongoose";
const schema=new mongoose.Schema({name:{type:String,required:true,trim:true},email:{type:String,required:true,unique:true,lowercase:true,trim:true},phone:{type:String,trim:true},passwordHash:{type:String,required:true},role:{type:String,enum:["customer","provider","admin"],default:"customer",index:true},isActive:{type:Boolean,default:true}},{timestamps:true});
export default mongoose.model("User",schema);
