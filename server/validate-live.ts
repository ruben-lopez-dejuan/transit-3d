import fs from 'node:fs';
import { positionAlong } from '../src/transit/motion';
import { distanceMeters } from './transit/motionEngine';
import type { Snapshot, Shape } from '../src/transit/networkTypes';
const base=process.env.TRANSIT_TEST_URL ?? 'http://localhost:3001';
const previous=new Map<string, Snapshot['vehicles'][number]>(), shapes=new Map<string, Shape>();
const samples: unknown[]=[], transitions: {operator:string;seconds:number;speed:number}[]=[];
const count=Number(process.env.TRANSIT_VALIDATE_SAMPLES ?? 9);
for(let i=0;i<count;i++) {
 const started=performance.now();const response=await fetch(base+'/api/transit');if(!response.ok)throw Error('Snapshot HTTP '+response.status);const snapshot=await response.json() as Snapshot;
 const keys=[...new Set(snapshot.vehicles.map(v=>v.shapeKey))].filter(k=>!shapes.has(k));
 for(let j=0;j<keys.length;j+=100){const r=await fetch(base+'/api/geometries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:keys.slice(j,j+100)})});for(const shape of await r.json() as Shape[])shapes.set(shape.key,shape);}
 const groups: Record<string,{total:number;gps:number;predicted:number;scheduled:number;maxShapeError:number}>={};
 for(const v of snapshot.vehicles){const g=groups[v.operatorId]??={total:0,gps:0,predicted:0,scheduled:0,maxShapeError:0};g.total++;if(v.observationTimestamp)g.gps++;else if(v.positionQuality==='predicted')g.predicted++;else g.scheduled++;
 const shape=shapes.get(v.shapeKey);if(shape){const point=positionAlong(shape,v.progressMetersAlongShape);if(point)g.maxShapeError=Math.max(g.maxShapeError,distanceMeters(point.coordinate,[v.longitude,v.latitude]));}
 if(v.observationTimestamp){const p=previous.get(v.id);if(p?.shapeKey===v.shapeKey&&p.observationTimestamp&&v.observationTimestamp>p.observationTimestamp){const seconds=(v.observationTimestamp-p.observationTimestamp)/1000;transitions.push({operator:v.operatorId,seconds,speed:(v.observationProgressMeters!-p.observationProgressMeters!)/seconds});}previous.set(v.id,v);}}
 const row={at:new Date().toISOString(),ms:Math.round(performance.now()-started),vehicles:snapshot.vehicles.length,groups};samples.push(row);console.log('[validation]',row.at,row.ms+' ms',row.vehicles+' vehicles',transitions.length+' GPS intervals');fs.writeFileSync('server/cache/validated-live.json',JSON.stringify({samples,transitions},null,2));
 if(i<count-1)await new Promise(resolve=>setTimeout(resolve,20000));
}
