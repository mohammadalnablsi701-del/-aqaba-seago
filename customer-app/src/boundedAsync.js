export async function withTimeout(factory,timeoutMs,{
  defaultTimeoutMs=5000,
  code="ASYNC_OPERATION_TIMEOUT",
  message="Operation timed out"
}={}){
  const configured=Number(timeoutMs);
  const fallback=Number(defaultTimeoutMs);
  const duration=Number.isFinite(configured)&&configured>0
    ?configured
    :(Number.isFinite(fallback)&&fallback>0?fallback:5000);
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          const error=new Error(message);
          error.code=code;
          reject(error);
        },duration);
      })
    ]);
  }finally{
    if(timer)clearTimeout(timer);
  }
}
