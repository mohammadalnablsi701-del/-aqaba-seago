import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Provider from "../models/Provider.js";

const ACCOUNTS=[
  {name:"Fun N Sun",email:"funnsun@providers.seago.test",businessName:"Fun N Sun"},
  {name:"Sea Breeze / Aquamarina",email:"seabreeze@providers.seago.test",businessName:"Sea Breeze / Aquamarina"},
  {name:"Aladdin Yachts & Marine Tours / Alaa Aldeen",email:"aladdin@providers.seago.test",businessName:"Aladdin Yachts & Marine Tours / Alaa Aldeen"}
];

export async function seedInitialProvidersOnce(){
  const password=String(process.env.INITIAL_PROVIDER_TEMP_PASSWORD||"");
  if(!password)return null;
  const passwordHash=await bcrypt.hash(password,12);
  const created=[];
  for(const spec of ACCOUNTS){
    let user=await User.findOne({email:spec.email});
    if(!user){
      user=await User.create({name:spec.name,email:spec.email,role:"provider",passwordHash,isActive:true});
    }else{
      user.name=spec.name;
      user.role="provider";
      user.passwordHash=passwordHash;
      user.isActive=true;
      await user.save();
    }
    let provider=await Provider.findOne({ownerUserId:user._id});
    if(!provider){
      provider=await Provider.create({
        ownerUserId:user._id,
        businessName:spec.businessName,
        status:"approved",
        approvedAt:new Date()
      });
    }else{
      provider.businessName=spec.businessName;
      provider.status="approved";
      provider.approvedAt ||= new Date();
      await provider.save();
    }
    created.push({userId:user._id,email:user.email,providerId:provider._id,businessName:provider.businessName,status:provider.status});
  }
  return created;
}
