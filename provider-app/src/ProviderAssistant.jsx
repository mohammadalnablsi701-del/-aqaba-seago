import React,{useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {ArrowDown,ArrowRight,CheckCircle2,Info,Mic,Send,ShipWheel,Square,X} from "lucide-react";
import "./provider-assistant.css";
import {useAssistantRecorder} from "./useAssistantRecorder.js";
import {AssistantWaveform,formatRecordingTime} from "./AssistantRecorder.jsx";

const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
const intro={role:"assistant",text:"أهلاً! أنا مساعد SeaGo 🌊\nاحكي معي بطبيعتك، بالشات أو بالصوت. بنقدر نجهّز رحلة جديدة خطوة بخطوة، أو نفحص المقاعد والحجوزات من بيانات شركتك."};
const starter=["بدي أضيف رحلة","كم مقعد محجوز اليوم؟","شو أسعار رحلاتي؟","عندي مشكلة في QR"];
const time=(v,language)=>new Date(v).toLocaleTimeString(language==="en"?"en-GB":"ar-JO",{timeZone:"Asia/Amman",hour:"2-digit",minute:"2-digit"});
export default function ProviderAssistant({token,onClose,onUseDraft}){
  const [messages,setMessages]=useState([intro]);
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [showInfo,setShowInfo]=useState(false);
  const [unread,setUnread]=useState(false);
  const [retry,setRetry]=useState(null);
  const [error,setError]=useState("");
  const [audioError,setAudioError]=useState("");
  const contextRef=useRef({mode:"",draft:{},pendingField:"",lang:"ar",focus:{intent:"",tripName:"",date:""}});
  const sendingRef=useRef(false),aliveRef=useRef(true),scrollRef=useRef(null),panelRef=useRef(null),requestRef=useRef(null);
  const nearBottomRef=useRef(true),scrollingUntilRef=useRef(0);
  const lang=contextRef.current.lang, english=lang==="en";
  const recorder=useAssistantRecorder({onSubmit:payload=>send(payload,english?"🎙️ Voice message":"🎙️ رسالة صوتية"),onError:setAudioError,lang,disabled:busy});
  const {recording,preparing,processing}=recorder;
  const audioActive=recording||preparing||processing;
  const locked=busy||audioActive;
  function scrollToLatest(smooth=true){
    const node=scrollRef.current;
    if(!node)return;
    nearBottomRef.current=true;setUnread(false);
    // Skip redundant scrolling while messages still fit in the viewport.
    if(node.scrollHeight-node.clientHeight-node.scrollTop<=1)return;
    scrollingUntilRef.current=performance.now()+450;
    node.scrollTo({top:node.scrollHeight,behavior:smooth&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches?"smooth":"instant"});
  }
  useLayoutEffect(()=>{
    if(nearBottomRef.current)scrollToLatest();
    else setUnread(true);
  },[messages,busy]);
  useEffect(()=>{
    aliveRef.current=true;
    const viewport=window.visualViewport;
    let frame;
    const resize=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        if(viewport&&panelRef.current){
          panelRef.current.style.setProperty("--assistant-viewport-height",`${viewport.height}px`);
          panelRef.current.style.setProperty("--assistant-viewport-top",`${viewport.offsetTop}px`);
        }
        if(nearBottomRef.current)scrollToLatest(false);
      });
    };
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(resize):null;
    if(scrollRef.current)observer?.observe(scrollRef.current);
    viewport?.addEventListener("resize",resize);viewport?.addEventListener("scroll",resize);resize();
    return ()=>{
      aliveRef.current=false;requestRef.current?.abort();cancelAnimationFrame(frame);observer?.disconnect();
      viewport?.removeEventListener("resize",resize);viewport?.removeEventListener("scroll",resize);
    };
  },[]);
  const latest=messages.at(-1);
  const chips=latest?.role==="assistant"&&Array.isArray(latest.suggestions)?latest.suggestions:(messages.length===1?starter:[]);
  async function send(payload,shown,isRetry=false){
    if(sendingRef.current)return;
    sendingRef.current=true;setBusy(true);setError("");setAudioError("");setRetry(null);
    if(!isRetry)setMessages(v=>[...v,{role:"user",text:shown,lang:/[\u0600-\u06ff]/.test(shown)?"ar":"en"}]);
    const controller=new AbortController();requestRef.current=controller;
    try{
      const response=await fetch(API+"/api/providers/me/assistant",{
        method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({...payload,context:contextRef.current})
      });
      const result=await response.json().catch(()=>({}));
      if(response.status===401){localStorage.removeItem("seago_provider_auth");window.dispatchEvent(new CustomEvent("seago:session-expired"));throw Object.assign(new Error(english?"Your session has expired.":"انتهت صلاحية تسجيل الدخول."),{status:401});}
      if(!response.ok)throw Object.assign(new Error(result.error||(english?"Unable to complete the request.":"تعذّر إكمال الطلب.")),{status:response.status});
      if(!aliveRef.current)return;
      const mode=result.mode==="create_trip"?"create_trip":result.mode==="seats"?"seats":"";
      contextRef.current={mode,draft:mode==="create_trip"&&result.draft&&typeof result.draft==="object"?result.draft:{},pendingField:mode==="create_trip"&&typeof result.pendingField==="string"?result.pendingField:"",lang:result.lang==="en"?"en":result.lang==="ar"?"ar":contextRef.current.lang,focus:result.focus&&typeof result.focus==="object"?result.focus:contextRef.current.focus};
      setMessages(v=>[...v,{
        role:"assistant",intent:result.intent,text:result.text||(contextRef.current.lang==="en"?"How can I help you?":"تمام، كيف بقدر أساعدك؟"),lang:contextRef.current.lang,source:result.source||"",
        transcript:payload.audioBase64?result.transcript||"":"",rows:Array.isArray(result.rows)?result.rows.slice(0,20):[],
        ready:result.ready===true,progress:Number(result.progress)||0,total:Number(result.total)||4,
        draft:mode==="create_trip"?contextRef.current.draft:null,
        suggestions:Array.isArray(result.suggestions)?result.suggestions.slice(0,4).filter(x=>typeof x==="string"):[]
      }]);
    }catch(e){if(aliveRef.current&&e.name!=="AbortError"){
      setError(e instanceof TypeError?(english?"Connection lost. Check your network and try again.":"تعذّر الاتصال. تأكد من الإنترنت وجرّب مرة ثانية."):(e.message||(english?"Please try again.":"جرّب مرة ثانية.")));
      if(!controller.signal.aborted&&e.status!==401)setRetry({payload,shown});
    }}
    finally{sendingRef.current=false;if(aliveRef.current)setBusy(false);}
  }
  function sendText(value=input){
    const text=String(value||"").trim();
    if(!text||text.length>1500||sendingRef.current||audioActive)return;
    setInput("");send({text},text);
  }
  function startAudio(){
    if(sendingRef.current)return;
    setError("");setRetry(null);setAudioError("");recorder.start();
  }
  function close(){recorder.cancel();requestRef.current?.abort();onClose();}
  const cancelDraft=useCallback(()=>{
    if(sendingRef.current||audioActive)return;
    contextRef.current={mode:"",draft:{},pendingField:"",lang:contextRef.current.lang,focus:contextRef.current.focus};
    setMessages(v=>[...v,{role:"assistant",text:contextRef.current.lang==="en"?"Trip draft canceled. Nothing was saved.":"تمام، لغينا المسودة من المحادثة. ما انحفظت ولا رحلة.",suggestions:contextRef.current.lang==="en"?["Create a trip","Today\u0027s bookings"]:starter,lang:contextRef.current.lang}]);
  },[audioActive]);

  // Keep operational rows and bubbles out of the input and recording-tick render path.
  const messageBubbles=useMemo(()=>messages.map((m,i)=><div key={i} className={"seago-assistant-message "+m.role+(m.role==="assistant"&&i>0?" seago-assistant-message-enter":"")} lang={m.lang||"ar"}>
        <p dir="auto">{m.text}</p>
        {m.transcript&&<small dir="auto">{m.lang==="en"?"🎙️ Heard: ":"🎙️ سمعت: "}{m.transcript}</small>}
        {m.source==="provider_data"&&<small>{m.lang==="en"?"✓ Verified from your company data":"✓ من البيانات المسجلة لشركتك"}</small>}
        {m.source==="guide"&&<small>{m.lang==="en"?"Troubleshooting guidance — not a verified diagnosis":"إرشادات للمشكلة — ليست تشخيصاً مؤكداً"}</small>}
        {m.intent==="create_trip"&&<div className="seago-assistant-progress"><div><span>{m.lang==="en"?"Trip setup":"تجهيز الرحلة"}</span><strong>{m.progress} / {m.total}</strong></div><div className="seago-assistant-progress-track"><span style={{width:Math.round(100*m.progress/(m.total||4))+"%"}}/></div></div>}
        {m.rows?.length>0&&<div className="seago-assistant-departures">{m.rows.map((d,j)=><div key={j}><strong>{d.trip}</strong><small>{time(d.startsAt,m.lang)} · {d.status==="scheduled"?(m.lang==="en"?"Scheduled":"مجدولة"):d.status}</small><span>{m.lang==="en"?"Confirmed":"مؤكد"}: {d.confirmedSeats} · {m.lang==="en"?"Available":"متاح"}: {d.availableSeats} · {m.lang==="en"?"Capacity":"السعة"}: {d.capacity}</span></div>)}</div>}
        {m.ready&&m.draft&&<button type="button" className="seago-assistant-draft-button" disabled={locked} onClick={()=>onUseDraft(m.draft)}><CheckCircle2 size={17}/> {m.lang==="en"?"Review trip form":"افتح نموذج الرحلة للمراجعة"} <ArrowRight size={16}/></button>}
        {m.intent==="create_trip"&&!m.ready&&i===messages.length-1&&<button type="button" className="seago-assistant-cancel-draft" disabled={locked} onClick={cancelDraft}>{m.lang==="en"?"Cancel trip draft":"إلغاء مسودة الرحلة"}</button>}
      </div>),[messages,locked,onUseDraft,cancelDraft]);
  return <div className="app"><div ref={panelRef} className="seago-assistant" dir={english?"ltr":"rtl"} lang={lang}>
    <header className="seago-assistant-header"><div><span className="seago-assistant-icon"><ShipWheel size={20}/></span><div><strong>{english?"SeaGo Assistant":"مساعد SeaGo"}</strong><small>{english?"Here to help, step by step":"احكي معي، خطوة بخطوة"}</small></div></div><div className="seago-assistant-header-actions"><button className="seago-assistant-info-toggle" type="button" onClick={()=>setShowInfo(v=>!v)} aria-label={english?"Privacy and information":"الخصوصية والمعلومات"} aria-expanded={showInfo} aria-controls="seago-assistant-info"><Info size={20}/></button><button type="button" onClick={close} aria-label={english?"Close assistant":"إغلاق المساعد"}><X size={22}/></button></div></header>
    {showInfo&&<section id="seago-assistant-info" className="seago-assistant-info" aria-label={english?"Privacy and information":"الخصوصية والمعلومات"}>
      <strong>{english?"Privacy & your control":"الخصوصية والتحكّم"}</strong>
      <p>{english?"Your text and voice messages are sent to Google to understand your request. Avoid sharing customers’ personal information.":"يُرسل محتوى رسائلك النصية أو الصوتية إلى Google لفهم طلبك. تجنّب مشاركة بيانات العملاء الشخصية."}</p>
      <p>{english?"Chat only prepares a draft. Review the trip form and press Save yourself to save a trip.":"ما بتم حفظ أي رحلة من المحادثة وحدها. راجع النموذج واضغط حفظ بنفسك."}</p>
    </section>}
    <div ref={scrollRef} className="seago-assistant-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label={english?"Provider assistant conversation":"محادثة مساعد المزود"}
      onWheel={()=>{scrollingUntilRef.current=0;}} onPointerDown={()=>{scrollingUntilRef.current=0;}} onTouchStart={()=>{scrollingUntilRef.current=0;}}
      onKeyDown={()=>{scrollingUntilRef.current=0;}} tabIndex={0}
      onScroll={e=>{
        if(performance.now()<scrollingUntilRef.current)return;
        const node=e.currentTarget;
        nearBottomRef.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;
        if(nearBottomRef.current)setUnread(false);
      }}>
      {/* Messages are append-only: stable keys keep existing bubbles mounted, so entrance motion never replays on input/timer updates. */}
      {messageBubbles}
      {busy&&<div className="seago-assistant-message assistant seago-assistant-thinking" role="status"><span className="seago-assistant-thinking-dots" aria-hidden="true"><i/><i/><i/></span><span>{english?"Thinking...":"المساعد يفكر..."}</span></div>}
    </div>
    {unread&&<button className="seago-assistant-jump" type="button" onClick={()=>scrollToLatest()}><ArrowDown size={16}/>{english?"Latest messages":"آخر الرسائل"}</button>}
    {chips.length>0&&<div key={JSON.stringify(chips)} className="seago-assistant-samples seago-assistant-samples-enter" aria-label={english?"Quick suggestions":"اقتراحات سريعة"}>{chips.map((s,i)=><button key={i} type="button" dir="auto" disabled={locked} onClick={()=>sendText(s)}>{s}</button>)}</div>}
    <footer className="seago-assistant-footer">
      {error&&<div className="seago-assistant-error" role="alert"><span>{error}</span>{retry&&<button type="button" disabled={locked} onClick={()=>send(retry.payload,retry.shown,true)}>{english?"Retry":"إعادة المحاولة"}</button>}</div>}
      {audioError&&<div className="seago-assistant-error" role="alert"><span>{audioError}</span><button type="button" disabled={locked} onClick={startAudio}>{english?"Record again":"إعادة التسجيل"}</button></div>}
      {recording&&<div className="seago-assistant-recording">
        <div className="seago-assistant-recording-top"><span className="seago-assistant-recording-status" role="status"><i className="seago-assistant-recording-dot" aria-hidden="true"/>{english?"Recording":"جاري التسجيل"}</span><span className="seago-assistant-recording-time" dir="ltr" aria-label={english?"Recording duration, maximum one minute":"مدة التسجيل، دقيقة واحدة كحد أقصى"}>{formatRecordingTime(recorder.elapsed)+" / 01:00"}</span></div>
        <AssistantWaveform stream={recorder.stream}/>
        <button type="button" className="seago-assistant-stop" onClick={recorder.stop}><Square size={16}/>{english?"Stop & Send":"إيقاف وإرسال"}</button>
      </div>}
      {(preparing||processing)&&!busy&&<div className="seago-assistant-audio-status" role="status">{preparing?(english?"Opening microphone…":"جاري فتح الميكروفون…"):(english?"Preparing voice message…":"جاري تجهيز الرسالة الصوتية…")}</div>}
      <form onSubmit={e=>{e.preventDefault();sendText();}}>
        <button type="button" disabled={busy||preparing||processing} onClick={recording?recorder.stop:startAudio} aria-label={recording?(english?"Stop and send recording":"أوقف وأرسل التسجيل"):(english?"Record voice message":"سجّل رسالة صوتية")} aria-pressed={recording} className={"seago-assistant-mic "+(recording?"recording":preparing?"preparing":"")}>{recording?<Square size={20}/>:<Mic size={20}/>}</button>
        <input aria-label={english?"Your message":"رسالتك"} dir="auto" disabled={locked} value={input} maxLength={1500} placeholder={english?"What can I help you with?":"احكيلي شو بدك تعمل…"} onChange={e=>setInput(e.target.value)}/>
        <button type="submit" disabled={locked||!input.trim()} aria-label={english?"Send":"إرسال"}><Send size={20}/></button>
      </form>
    </footer>
  </div></div>;
}
