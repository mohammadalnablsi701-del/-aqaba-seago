import mongoose from "mongoose";

export const ADMIN_AUDIT_ACTIONS=[
  "provider_approved",
  "provider_rejected",
  "provider_suspended",
  "provider_reactivated",
  "provider_returned_to_pending",
  "provider_access_reset",
  "trip_platform_paused",
  "trip_platform_allowed",
  "commission_updated"
];

export const ADMIN_AUDIT_ENTITY_TYPES=["provider","trip"];

const schema=new mongoose.Schema({
  actorUserId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  actorEmail:{type:String,required:true,trim:true,lowercase:true,maxlength:320},
  actorName:{type:String,trim:true,maxlength:160,default:""},
  actorRole:{type:String,required:true,enum:["admin"]},
  action:{type:String,required:true,enum:ADMIN_AUDIT_ACTIONS,index:true},
  entityType:{type:String,required:true,enum:ADMIN_AUDIT_ENTITY_TYPES,index:true},
  entityId:{type:mongoose.Schema.Types.ObjectId,required:true,index:true},
  entityLabel:{type:String,trim:true,maxlength:220,default:""},
  reason:{type:String,trim:true,maxlength:500,default:null},
  before:{type:mongoose.Schema.Types.Mixed,default:null},
  after:{type:mongoose.Schema.Types.Mixed,default:null},
  metadata:{type:mongoose.Schema.Types.Mixed,default:{}}
},{timestamps:{createdAt:true,updatedAt:false},versionKey:false});

schema.index({entityType:1,entityId:1,createdAt:-1});
schema.index({createdAt:-1});

function appendOnlyError(){
  return Object.assign(new Error("Admin audit log is append-only"),{code:"ADMIN_AUDIT_APPEND_ONLY"});
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

export default mongoose.model("AdminAuditLog",schema);
