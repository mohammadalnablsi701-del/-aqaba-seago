// Only operator-supplied HTTPS links can be used as photographs of real trips.
export function trustedTripImages(images){
  if(!Array.isArray(images))return [];
  return images.map(item=>typeof item==="string"?item:item?.url)
    .filter(value=>{
      if(typeof value!=="string")return false;
      try {
        const url=new URL(value);
        return url.protocol==="https:"&&Boolean(url.hostname)&&!url.username&&!url.password;
      }catch{return false;}
    }).slice(0,10);
}
