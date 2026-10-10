const MIN_REASON_LENGTH=4;
export const MAX_ADMIN_ACTION_REASON_LENGTH=500;

export function normalizeAdminActionReason(value,{required=true}={}){
  if(value===undefined||value===null){
    if(required)throw Object.assign(new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`),{statusCode:400});
    return "";
  }
  if(typeof value!=="string")throw Object.assign(new Error("Reason must be plain text"),{statusCode:400});
  const reason=value.trim();
  if(!reason){
    if(required)throw Object.assign(new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`),{statusCode:400});
    return "";
  }
  if(reason.length<MIN_REASON_LENGTH)throw Object.assign(new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`),{statusCode:400});
  if(reason.length>MAX_ADMIN_ACTION_REASON_LENGTH)throw Object.assign(new Error(`Reason must be ${MAX_ADMIN_ACTION_REASON_LENGTH} characters or fewer`),{statusCode:400});
  return reason;
}

export function attachAdminActionReason(req,options){
  const reason=normalizeAdminActionReason(req.body?.reason,options);
  req.adminActionReason=reason;
  return reason;
}
