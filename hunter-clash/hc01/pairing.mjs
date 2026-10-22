// QR payload contains only a one-time sandbox capability, never an Auth token.
const ID=/^[A-Za-z0-9_-]{1,128}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function pairingPayload(challengeId,token){
  if(typeof challengeId!=='string'||typeof token!=='string'||!ID.test(challengeId)||!TOKEN.test(token))throw Error('invalid-pairing');
  return 'bxh-hc01:'+challengeId+':'+token;
}
export function parsePairingPayload(value){
  if(typeof value!=='string'||value.length>200)throw Error('invalid-pairing');
  const parts=value.trim().split(':');
  if(parts.length!==3||parts[0]!=='bxh-hc01'||!ID.test(parts[1])||!TOKEN.test(parts[2]))throw Error('invalid-pairing');
  return {challengeId:parts[1],pairingToken:parts[2]};
}
export function renderPairingQr(container,payload,QRCode){
  parsePairingPayload(payload);
  if(typeof QRCode!=='function')throw Error('qr-renderer-unavailable');
  container.replaceChildren();return new QRCode(container,{text:payload,width:220,height:220});
}
