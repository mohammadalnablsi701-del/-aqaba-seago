import {useCallback,useEffect,useRef,useState} from "react";

export const RECORDING_LIMIT_MS=60_000;
export const RECORDING_MAX_BYTES=1_200_000;
const supportedFormats=new Set(["audio/webm","audio/mp4","audio/m4a","audio/ogg","audio/mpeg","audio/mp3","audio/wav"]);
const copy={
  ar:{unsupported:"تسجيل الصوت أو صيغته مش مدعومة على جهازك. جرّب الشات أو متصفحاً آخر.",permission:"الوصول للميكروفون مرفوض. اسمح له من إعدادات المتصفح ثم جرّب مرة ثانية.",unavailable:"الميكروفون غير متاح حالياً. تأكد أنه مش مستخدم بتطبيق آخر وجرّب مرة ثانية.",empty:"ما وصل صوت بالتسجيل. جرّب تسجّل مرة ثانية.",large:"حجم التسجيل أكبر من المسموح. جرّب رسالة أقصر أو استخدم الشات.",failed:"تعذّر تسجيل الصوت. جرّب مرة ثانية.",upload:"تعذّر إرسال التسجيل. تأكد من الاتصال وجرّب مرة ثانية."},
  en:{unsupported:"Audio recording or this format is not supported. Try chat or another browser.",permission:"Microphone access was denied. Allow it in your browser settings, then try again.",unavailable:"The microphone is unavailable. Check that another app is not using it, then try again.",empty:"The recording was empty. Please record again.",large:"The recording is too large. Try a shorter message or use chat.",failed:"Could not record audio. Please try again.",upload:"Could not send the recording. Check your connection and try again."}
};

function release(session){
  clearTimeout(session.deadline);
  clearInterval(session.ticker);
  if(session.stream&&!session.streamReleased){
    session.streamReleased=true;
    session.stream.getTracks().forEach(track=>track.stop());
  }
}

function readAudio(blob,session){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    session.reader=reader;
    reader.onerror=reader.onabort=()=>reject(new Error("read"));
    reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");
    reader.readAsDataURL(blob);
  });
}

/** One session owns permission, capture, conversion and upload, including stop races. */
export function useAssistantRecorder({onSubmit,onError,lang="ar",disabled=false}){
  const [recording,setRecording]=useState(false);
  const [preparing,setPreparing]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [stream,setStream]=useState(null);
  const current=useRef(null);
  const mounted=useRef(true);
  const options=useRef({onSubmit,onError,lang,disabled});
  options.current={onSubmit,onError,lang,disabled};

  const cancel=useCallback(()=>{
    const session=current.current;
    current.current=null;
    if(session){
      session.cancelled=true;
      if(session.recorder){
        session.recorder.onstop=null;
        session.recorder.onerror=null;
        session.recorder.ondataavailable=null;
        try{if(session.recorder.state!=="inactive")session.recorder.stop();}catch{}
      }
      if(session.reader?.readyState===1)session.reader.abort();
      release(session);
    }
    if(mounted.current){setRecording(false);setPreparing(false);setProcessing(false);setStream(null);}
  },[]);

  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;cancel();};
  },[cancel]);

  const stop=useCallback(()=>{
    const session=current.current;
    if(!session||session.stopping||!session.recorder||session.recorder.state!=="recording")return;
    session.stopping=true;
    clearTimeout(session.deadline);
    clearInterval(session.ticker);
    if(mounted.current){
      setElapsed(Math.min(60,Math.floor((performance.now()-session.startedAt)/1000)));
      setRecording(false);setProcessing(true);
    }
    try{session.recorder.stop();}
    catch{
      cancel();
      options.current.onError?.(copy[options.current.lang==="en"?"en":"ar"].failed);
    }
  },[cancel]);

  const start=useCallback(async()=>{
    if(current.current||options.current.disabled||!mounted.current)return;
    const session={cancelled:false,stopping:false,finished:false,chunks:[]};
    current.current=session;
    const active=()=>mounted.current&&!session.cancelled&&current.current===session;
    const report=key=>{if(active())options.current.onError?.(copy[options.current.lang==="en"?"en":"ar"][key]);};
    const reset=()=>{
      release(session);
      if(current.current===session)current.current=null;
      if(mounted.current&&!session.cancelled){setRecording(false);setPreparing(false);setProcessing(false);setStream(null);}
    };
    setPreparing(true);setElapsed(0);
    options.current.onError?.("");
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){
      report("unsupported");reset();return;
    }
    try{
      session.stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!active()){release(session);return;}
      const mime=["audio/mp4","audio/webm;codecs=opus","audio/webm"].find(value=>MediaRecorder.isTypeSupported?.(value));
      const recorder=mime?new MediaRecorder(session.stream,{mimeType:mime}):new MediaRecorder(session.stream);
      session.recorder=recorder;
      const format=String(recorder.mimeType||mime||"").split(";")[0].toLowerCase();
      if(!supportedFormats.has(format)){report("unsupported");reset();return;}
      recorder.ondataavailable=event=>{if(!session.cancelled&&event.data?.size)session.chunks.push(event.data);};
      recorder.onerror=()=>{
        report("failed");cancel();
      };
      recorder.onstop=async()=>{
        if(session.finished)return;
        session.finished=true;
        release(session);
        if(!active())return;
        setRecording(false);setStream(null);setProcessing(true);
        const blob=new Blob(session.chunks,{type:format});
        // 150 bytes encode to the backend's minimum 200 base64 characters.
        if(blob.size<150){report("empty");reset();return;}
        if(blob.size>RECORDING_MAX_BYTES){report("large");reset();return;}
        try{
          const audioBase64=await readAudio(blob,session);
          if(active())await options.current.onSubmit?.({audioBase64,audioMimeType:format});
        }catch{report("upload");}
        finally{reset();}
      };
      recorder.start(250);
      session.startedAt=performance.now();
      setElapsed(0);setPreparing(false);setRecording(true);setStream(session.stream);
      session.deadline=setTimeout(stop,RECORDING_LIMIT_MS);
      session.ticker=setInterval(()=>{
        if(!active()||session.stopping)return;
        const milliseconds=performance.now()-session.startedAt;
        setElapsed(Math.min(60,Math.floor(milliseconds/1000)));
        if(milliseconds>=RECORDING_LIMIT_MS)stop();
      },250);
    }catch(error){
      if(active())report(error?.name==="NotAllowedError"||error?.name==="SecurityError"?"permission":error?.name==="NotSupportedError"?"unsupported":"unavailable");
      reset();
    }
  },[cancel,stop]);

  return {recording,preparing,processing,elapsed,stream,start,stop,cancel};
}

export default useAssistantRecorder;
