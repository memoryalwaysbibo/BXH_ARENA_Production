// @jsquash/webp 1.5.0 / Squoosh (Apache-2.0); see LICENSE and LICENSE.codec.md.
// Local, single-threaded non-SIMD encoder, loaded only when native WebP is absent.
import factory from './webp_enc.js';
import {defaultOptions} from './meta.js';
let ready;
export default async function encode(image){
 if(!ready)ready=factory({noInitialRun:true}).catch(error=>{ready=null;throw error;});
 const module=await ready;
 const result=module.encode(image.data,image.width,image.height,{...defaultOptions,quality:82});
 if(!result)throw Error('image-processing-failed');
 return result.buffer;
}
