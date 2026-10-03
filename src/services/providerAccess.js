import Provider from "../models/Provider.js";
import ProviderMember from "../models/ProviderMember.js";

export const ROLE_CAPABILITIES={
  owner:["manage_team","manage_settings","manage_trips","manage_departures","view_bookings","checkin","view_finance"],
  manager:["manage_settings","manage_trips","manage_departures","view_bookings","checkin","view_finance"],
  staff:["manage_departures","view_bookings","checkin"],
  checkin:["view_bookings","checkin"]
};

export async function resolveProviderAccess(user,{approved=true}={}){
  if(!user||user.role!=="provider")return null;
  let provider=await Provider.findOne({ownerUserId:user._id,...(approved?{status:"approved"}:{})});
  if(provider)return{provider,accessRole:"owner",capabilities:ROLE_CAPABILITIES.owner};
  const membership=await ProviderMember.findOne({userId:user._id,isActive:true}).populate("providerId");
  if(!membership?.providerId)return null;
  provider=membership.providerId;
  if(approved&&provider.status!=="approved")return null;
  const accessRole=membership.role;
  return{provider,accessRole,capabilities:ROLE_CAPABILITIES[accessRole]||[]};
}

export async function requireProviderCapability(user,capability,options={}){
  const access=await resolveProviderAccess(user,options);
  if(!access||!access.capabilities.includes(capability))return null;
  return access;
}
