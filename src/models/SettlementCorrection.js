import mongoose from "mongoose";

const schema=new mongoose.Schema({
  settlementId:{type:mongoose.Schema.Types.ObjectId,ref:"ProviderSettlement",required:true,unique:true,index:true,immutable:true},
  providerId:{type:mongoose.Schema.Types.ObjectId,ref:"Provider",required:true,index:true,immutable:true},
  type:{type:String,enum:["payment_reversal"],required:true,default:"payment_reversal",immutable:true},
  originalAmount:{type:Number,min:0,required:true,immutable:true},
  amountDelta:{type:Number,max:0,required:true,immutable:true},
  currency:{type:String,required:true,trim:true,maxlength:8,immutable:true},
  reason:{type:String,required:true,trim:true,minlength:4,maxlength:500,immutable:true},
  actorUserId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,immutable:true},
  reversedAt:{type:Date,required:true,default:Date.now,index:true,immutable:true}
},{timestamps:{createdAt:true,updatedAt:false},versionKey:false});

schema.index({providerId:1,reversedAt:-1});

function appendOnlyError(){
  return Object.assign(new Error("Settlement correction history is append-only"),{code:"SETTLEMENT_CORRECTION_APPEND_ONLY"});
}

schema.pre("save",function(next){
  if(!this.isNew)return next(appendOnlyError());
  next();
});
for(const operation of ["updateOne","updateMany","findOneAndUpdate","replaceOne","findOneAndReplace","deleteMany","findOneAndDelete"]){
  schema.pre(operation,function(next){next(appendOnlyError());});
}
schema.pre("deleteOne",{query:true,document:false},function(next){next(appendOnlyError());});
schema.pre("deleteOne",{query:false,document:true},function(next){next(appendOnlyError());});

export default mongoose.model("SettlementCorrection",schema);
