import {getNetwork,getPresentationSnapshot} from './transit/network';
process.env.TRANSIT_PROFILE='1';
let t=performance.now();const network=await getNetwork();console.log('[profile] catalog',Math.round(performance.now()-t),'ms',network.routes.length,'routes');
for(let i=0;i<3;i++){t=performance.now();const s=await getPresentationSnapshot();console.log('[profile] presentation',Math.round(performance.now()-t),'ms',s.vehicles.length,'vehicles');if(i<2)await new Promise(r=>setTimeout(r,6000));}
