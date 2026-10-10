const numberOrZero=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const text=(value,max=160)=>String(value??"").trim().slice(0,max);
const objectId=value=>value&&typeof value==="object"?(value._id||value.id||""):value;

export function bookingReference(value){
  const id=text(objectId(value),64);
  return id?`SG-${id.slice(-8).toUpperCase()}`:"";
}

export function getAttentionCategories(data){
  const alerts=data?.alerts||{};
  const payment=numberOrZero(alerts.paymentNeedsReview);
  const notification=numberOrZero(alerts.notificationFailures24h);
  const support=numberOrZero(alerts.openSupport);
  return [
    {id:"payment",count:payment,label:payment===1?"Payment needs review":"Payments need review",priority:1,destination:"payments"},
    {id:"notification",count:notification,label:notification===1?"Notification failed":"Notification failures",priority:2,destination:"notifications"},
    {id:"support",count:support,label:support===1?"Open support request":"Open support requests",priority:3,destination:"support"}
  ];
}

export function hasOperationalAttention(data){
  return getAttentionCategories(data).some(category=>category.count>0);
}

function paymentPreview(item){
  const paymentId=text(item?.externalPaymentId,80)||(`PAY-${text(item?._id,64).slice(-8).toUpperCase()}`);
  const amount=Number(item?.amount);
  const money=Number.isFinite(amount)?`${amount.toFixed(2)} ${text(item?.currency,12)||"JOD"}`:"";
  const booking=bookingReference(item?.bookingId);
  return {
    id:`payment:${text(item?._id||paymentId,96)}`,
    kind:"payment",
    title:`Payment ${paymentId} needs review`,
    details:[booking,money,text(item?.status,40)||"needs_review"].filter(Boolean),
    time:item?.updatedAt||item?.createdAt||null,
    destination:"payments",
    targetId:text(item?._id,64)||null
  };
}

function notificationPreview(item){
  const type=text(item?.type,80).replaceAll("_"," ")||"Notification";
  const booking=bookingReference(item?.bookingId);
  const channel=text(item?.provider,60);
  const error=text(item?.error,240);
  return {
    id:`notification:${text(item?._id||`${type}:${item?.createdAt||""}`,120)}`,
    kind:"notification",
    title:`${type} failed`,
    details:[channel,booking,error].filter(Boolean),
    time:item?.createdAt||null,
    destination:"notifications"
  };
}

function supportPreview(item){
  const customer=text(item?.customerId?.name,120)||"Customer";
  const booking=text(item?.bookingReference,40)||bookingReference(item?.bookingId);
  return {
    id:`support:${text(item?._id||`${customer}:${item?.createdAt||""}`,120)}`,
    kind:"support",
    title:text(item?.subject,120)||"Open support request",
    details:[customer,booking,text(item?.status,40)||"open"].filter(Boolean),
    time:item?.createdAt||null,
    destination:"support"
  };
}

export function buildQueuePreview(data,maxItems=5){
  const queues=data?.queues||{};
  const groups=[
    (Array.isArray(queues.paymentNeedsReview)?queues.paymentNeedsReview:[]).map(paymentPreview),
    (Array.isArray(queues.notificationFailures)?queues.notificationFailures:[]).map(notificationPreview),
    (Array.isArray(queues.openSupport)?queues.openSupport:[]).map(supportPreview)
  ];
  const limit=Math.max(0,Math.min(10,Number(maxItems)||0));
  const result=[];
  for(const group of groups){
    if(result.length>=limit)break;
    if(group.length)result.push(group.shift());
  }
  while(result.length<limit&&groups.some(group=>group.length)){
    for(const group of groups){
      if(result.length>=limit)break;
      if(group.length)result.push(group.shift());
    }
  }
  return result;
}
