export function createLatestRequestManager(){
  let generation=0;
  let controller=null;

  return {
    start(){
      controller?.abort();
      controller=new AbortController();
      const id=++generation;
      return {id,signal:controller.signal};
    },
    isCurrent(id){
      return id===generation;
    },
    finish(id){
      if(id===generation)controller=null;
    },
    cancel(){
      generation+=1;
      controller?.abort();
      controller=null;
    }
  };
}

export function isAbortError(error){
  return error?.name==="AbortError"||error?.code==="ABORT_ERR";
}

export function rowsForSelectedDate(rows,loadedDate,selectedDate){
  return loadedDate===selectedDate?rows:[];
}
