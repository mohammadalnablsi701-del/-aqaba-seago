import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Provider from "../models/Provider.js";

const SEA_BREEZE_PROVIDER_RE=/(sea\s*breeze|aqua\s*marina|aquamarina)/i;

export async function bootstrapSeaBreezeOwnerOnce(){
  if(process.env.BOOTSTRAP_SEABREEZE_OWNER!=="true") return null;
  const email=String(process.env.SEABREEZE_LOGIN_EMAIL||"").trim().toLowerCase();
  const password=String(process.env.SEABREEZE_LOGIN_PASSWORD||"");
  if(!email||password.length<12) throw new Error("Sea Breeze login credentials are not configured");
  const providers=await Provider.find({businessName:SEA_BREEZE_PROVIDER_RE});
  if(providers.length!==1) return {ok:false,skipped:providers.length?"ambiguous_provider":"provider_not_found",providerCount:providers.length};
  const provider=providers[0];
  let user=await User.findOne({email});
  const passwordHash=await bcrypt.hash(password,12);
  if(!user){user=await User.create({name:"Sea Breeze / Aquamarina",email,role:"provider",passwordHash,isActive:true});}
  else{user.name="Sea Breeze / Aquamarina";user.role="provider";user.passwordHash=passwordHash;user.isActive=true;await user.save();}
  provider.ownerUserId=user._id;provider.status="approved";provider.approvedAt=provider.approvedAt||new Date();await provider.save();
  return {ok:true,providerId:String(provider._id),ownerUserId:String(user._id),email:user.email,status:provider.status};
}
