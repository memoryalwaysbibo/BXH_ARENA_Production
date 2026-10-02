function splitLegacyVenueText(value){
  const text=String(value||"").trim();
  if(!text) return {name:"",address:"",legacyText:""};
  const parts=text.split("｜").map(s=>s.trim()).filter(Boolean);
  if(parts.length>=2) return {name:parts[0],address:parts.slice(1).join("｜"),legacyText:text};
  return {name:text,address:"",legacyText:text};
}

function buildLegacyVenueText(venue){
  const v=venue&&typeof venue==="object"?venue:{};
  const name=String(v.name||"").trim();
  const address=String(v.address||"").trim();
  if(name&&address) return name+"｜"+address;
  return name||address||String(v.legacyText||"").trim();
}

function normalizeGoogleMapsUrl(value){
  if(typeof value!=="string")return "";
  const raw=value.trim();
  if(!raw||raw.length>2048||/[\s\u0000-\u001f\u007f\\]/.test(raw)||/%(?:00|0a|0d)/i.test(raw))return "";
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port)return "";
    const host=u.hostname.toLowerCase();
    if(host==="maps.app.goo.gl"&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return u.href;
    if(host==="maps.google.com"&&(u.pathname==="/"||/^\/maps(?:\/|$)/.test(u.pathname)))return u.href;
    if(["www.google.com","google.com","www.google.com.tw","google.com.tw"].includes(host)&&/^\/maps(?:\/|$)/.test(u.pathname))return u.href;
  }catch(e){}
  return "";
}
function extractGoogleMapsUrlsFromText(text){
  const source=String(text||"");
  const candidates=source.match(/https:\/\/[^\s<>"']+/ig)||[];
  const urls=[];
  for(const candidate of candidates){
    let raw=candidate.replace(/[\]}>，。！？、,;；]+$/g,"");
    while(raw.endsWith(")")&&(raw.match(/\)/g)||[]).length>(raw.match(/\(/g)||[]).length)raw=raw.slice(0,-1);
    const normalized=normalizeGoogleMapsUrl(raw);
    if(normalized&&!urls.includes(normalized))urls.push(normalized);
  }
  return urls;
}
function extractGoogleMapsUrlFromText(text){
  const urls=extractGoogleMapsUrlsFromText(text);
  return urls.length===1?urls[0]:"";
}
function googleMapsNavigationUrl(venue){
  const v=venue&&typeof venue==="object"?venue:{};
  const direct=normalizeGoogleMapsUrl(v.googleMapsUrl);
  if(direct)return direct;
  const address=String(v.address||"").trim();
  if(!address)return ""; // Do not guess a branch from its name alone.
  const url="https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(address);
  return url.length<=2048?url:"";
}
function appleMapsNavigationUrl(venue){
  const address=String(venue&&venue.address||"").trim();
  if(!address)return "";
  const url="https://maps.apple.com/?daddr="+encodeURIComponent(address);
  return url.length<=2048?url:"";
}

Object.assign(window.BXHVenueUtils||(window.BXHVenueUtils={}),{splitLegacyVenueText,buildLegacyVenueText,normalizeGoogleMapsUrl,extractGoogleMapsUrlsFromText,extractGoogleMapsUrlFromText,googleMapsNavigationUrl,appleMapsNavigationUrl});
