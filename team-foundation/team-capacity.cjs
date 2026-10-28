'use strict';
const CAP=200,CONTROL='teamCapacityControlV1/current';
// Must be initialized from an authoritative active-team count before enabling.
function capacityAfter(current,delta){
 if(!Number.isSafeInteger(current)||current<0||current>CAP||![1,-1].includes(delta))throw Error('team-capacity-unavailable');
 if(delta===1&&current===CAP)throw Error('team-capacity-full');
 if(delta===-1&&current===0)throw Error('team-capacity-unavailable');
 return current+delta;
}
module.exports={CAP,CONTROL,capacityAfter};
