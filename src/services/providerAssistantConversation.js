/**
 * Provider AI conversation state is deliberately supplied by the browser per turn.
 * It is an untrusted, minimal trip draft only; never store customer records, tokens,
 * provider IDs, booking data, or conversation transcripts in this context.
 */
const categories=new Set(["group_boat","private_boat","yacht","glass_bottom","snorkeling","diving","fishing","sunset","private_event","water_sports","semi_submarine"]);
const clean=(v,max=120)=>typeof v==="string"?v.trim().replace(/\s+/g," ").slice(0,max):"";
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const number=(v,max)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):undefined;

export function sanitizeTripConversationDraft(input){
  if(!input||typeof input!=="object"||Array.isArray(input))return {};
  const draft={};
  for(const key of ["titleAr","titleEn","vesselName","locationName","address"]){
    if(own(input,key)){
      const value=clean(input[key],key==="address"?220:120);
      if(value)draft[key]=value;
    }
  }
  if(own(input,"category")&&categories.has(input.category))draft.category=input.category;
  if(own(input,"durationMinutes")){
    const value=number(input.durationMinutes,1440);
    if(Number.isInteger(value)&&value>=15)draft.durationMinutes=value;
  }
  for(const key of ["adultPrice","childPrice"]){
    if(own(input,key)){
      const value=number(input[key],10000);
      if(value!==undefined)draft[key]=value;
    }
  }
  return draft;
}
export function mergeTripConversationDraft(current,delta){
  return {...sanitizeTripConversationDraft(current),...sanitizeTripConversationDraft(delta)};
}
export function assistantConversationContext(raw){
  return {mode:["create_trip","seats"].includes(raw?.mode)?raw.mode:"",
    draft:sanitizeTripConversationDraft(raw?.draft)};
}
const fields=[
  {key:"title",question:"تمام! بنجهّز الرحلة سوا 🌊 شو بدك تسمّيها؟",choices:["رحلة غروب","رحلة سنوركلينغ","رحلة بحرية"]},
  {key:"durationMinutes",question:"حلو! كم مدة الرحلة؟",choices:["ساعة","ساعتين","3 ساعات"]},
  {key:"adultPrice",question:"كم سعر الشخص الكبير بالدينار الأردني؟",choices:["15 دينار","20 دينار","25 دينار"]},
  {key:"childPrice",question:"وكم سعر الطفل من عمر 6 إلى 12 سنة؟",choices:["10 دنانير","15 دينار","نفس سعر الكبير"]}
];
export function tripConversationStep(input){
  const draft=sanitizeTripConversationDraft(input);
  const completed=[Boolean(draft.titleAr||draft.titleEn),draft.durationMinutes!==undefined,draft.adultPrice!==undefined,draft.childPrice!==undefined];
  const progress=completed.filter(Boolean).length;
  const missing=completed.indexOf(false);
  if(missing!==-1){
    const field=fields[missing];
    return {draft,ready:false,progress,total:fields.length,askFor:field.key,text:field.question,suggestions:field.choices};
  }
  const title=draft.titleAr||draft.titleEn;
  const text="هيك جهّزنا مسودة «"+title+"» ✅\nالمدة: "+draft.durationMinutes+" دقيقة\nسعر الكبير: "+draft.adultPrice+" د.أ\nسعر الطفل: "+draft.childPrice+" د.أ\n\nافتح النموذج، وراجع المكان والصور وباقي التفاصيل قبل حفظ الرحلة. ما تم إنشاء أي شيء لحد الآن.";
  return {draft,ready:true,progress,total:fields.length,askFor:null,text,suggestions:["بدي أغيّر السعر","بدي أعدّل مدة الرحلة"]};
}
export function assistantSuggestionList(input){
  return Array.isArray(input)?input.filter(x=>typeof x==="string").slice(0,4).map(x=>x.trim().slice(0,90)).filter(Boolean):[];
}
