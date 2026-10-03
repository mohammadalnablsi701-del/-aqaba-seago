import ProviderAuditLog from "../models/ProviderAuditLog.js";
export async function auditProviderAction({access,user,action,targetType,targetId=null,summary,metadata={}}){
  if(!access?.provider||!user)return null;
  return ProviderAuditLog.create({
    providerId:access.provider._id,
    actorUserId:user._id,
    actorRole:access.accessRole||"owner",
    action,targetType,targetId:targetId||undefined,summary,metadata
  });
}
