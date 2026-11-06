import React,{useEffect,useRef,useState} from "react";

const BAR_COUNT=19;

/** Direct bar updates keep microphone analysis out of the React render path. */
export function AssistantWaveform({stream}){
  const waveformRef=useRef(null);
  const [fallback,setFallback]=useState(true);
  useEffect(()=>{
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    const preference=window.matchMedia("(prefers-reduced-motion: reduce)");
    let context,source,analyser,ticker=0,disposed=false;
    const bars=Array.from(waveformRef.current?.children||[]);
    const samples=new Uint8Array(256);
    const stopFrame=()=>{clearInterval(ticker);ticker=0;};
    const paint=()=>{
      if(disposed||preference.matches||document.hidden)return;
      analyser.getByteTimeDomainData(samples);
      bars.forEach((bar,index)=>{
        const start=Math.floor(index*samples.length/BAR_COUNT);
        const end=Math.floor((index+1)*samples.length/BAR_COUNT);
        let power=0;
        for(let i=start;i<end;i++)power+=((samples[i]-128)/128)**2;
        const level=Math.min(1,.14+Math.sqrt(power/Math.max(1,end-start))*3.8);
        bar.style.setProperty("--bar-level",level.toFixed(3));
      });
    };
    const sync=()=>{
      stopFrame();
      if(analyser&&!preference.matches&&!document.hidden){paint();ticker=setInterval(paint,80);}
    };
    if(AudioContext&&stream){
      try{
        context=new AudioContext();
        source=context.createMediaStreamSource(stream);
        analyser=context.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.7;
        source.connect(analyser);
        setFallback(false);
        if(context.state==="suspended")context.resume().catch(()=>{
          if(!disposed){stopFrame();analyser=null;setFallback(true);}
        });
        sync();
      }catch{setFallback(true);}
    }
    preference.addEventListener?.("change",sync);
    document.addEventListener("visibilitychange",sync);
    return ()=>{
      disposed=true;stopFrame();
      preference.removeEventListener?.("change",sync);
      document.removeEventListener("visibilitychange",sync);
      source?.disconnect();analyser?.disconnect();
      if(context&&context.state!=="closed")context.close().catch(()=>{});
    };
  },[stream]);
  return <div ref={waveformRef} className={"seago-assistant-waveform"+(fallback?" is-fallback":"")} aria-hidden="true">
    {Array.from({length:BAR_COUNT},(_,index)=><i key={index} style={{"--bar-level":.18+(index%5)*.1,"--bar-index":index}}/>)}
  </div>;
}

export function formatRecordingTime(seconds){
  const value=Math.min(60,Math.max(0,Math.floor(seconds)));
  return `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
}
