import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Provider from "../models/Provider.js";

export async function bootstrapFunNSunOwnerOnce(){
  if(process.env.BOOTSTRAP_FUNNSUN_OWNER!=="true") return null;

  const email=String(process.env.FUNNSUN_LOGIN_EMAIL||"").trim().toLowerCase();
  const password=String(process.env.FUNNSUN_LOGIN_PASSWORD||"");
  if(!email||password.length<12) throw new Error("Fun N Sun login credentials are not configured");

  const provider=await Provider.findOne({businessName:"Fun N Sun"});
  if(!provider) return {ok:false,skipped:"provider_not_found"};

  let user=await User.findOne({email});
  const passwordHash=await bcrypt.hash(password,12);

  if(!user){
    user=await User.create({
      name:"Fun N Sun",
      email,
      role:"provider",
      passwordHash,
      isActive:true
    });
  }else{
    user.name="Fun N Sun";
    user.role="provider";
    user.passwordHash=passwordHash;
    user.isActive=true;
    await user.save();
  }

  provider.ownerUserId=user._id;
  provider.status="approved";
  provider.approvedAt=provider.approvedAt||new Date();
  await provider.save();

  return {
    ok:true,
    providerId:String(provider._id),
    ownerUserId:String(user._id),
    email:user.email,
    status:provider.status
  };
}
