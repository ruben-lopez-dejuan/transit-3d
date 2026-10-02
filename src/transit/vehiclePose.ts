import type { Shape, Vehicle } from './networkTypes';
import { positionAlong } from './motion';

export function composition(vehicle: Pick<Vehicle, 'mode' | 'operatorId'>) {
  if (vehicle.mode === 'bus') return { count: 1, length: 12, gap: 0 };
  if (vehicle.mode === 'funicular') return { count: 1, length: 12, gap: 0 };
  if (vehicle.mode === 'tram') return { count: 3, length: 10, gap: .6 };
  return vehicle.operatorId === 'renfe' ? { count: 3, length: 23, gap: 1 } : { count: 4, length: 17, gap: 1 };
}
/** Each car samples the track separately; offsets are a diagrammatic separation. */
export function vehiclePose(shape: Shape, progress: number, vehicle: Pick<Vehicle, 'mode' | 'operatorId' | 'label'>, lateralScale = 1) {
  const position = positionAlong(shape, progress); if (!position) return null;
  const rail = vehicle.mode === 'rail' || vehicle.mode === 'tram';
  const lateral = rail && !(vehicle.operatorId === 'renfe' && /^C[45]/.test(vehicle.label)) ? 1.7 * lateralScale : 0;
  const angle = position.bearing * Math.PI / 180;
  const coordinate: [number, number] = [position.coordinate[0] + lateral * Math.cos(angle) / (111320 * Math.cos(position.coordinate[1] * Math.PI / 180)), position.coordinate[1] - lateral * Math.sin(angle) / 110540];
  const tunnel = shape.underground?.find((s) => progress >= s.from && progress <= s.to);
  const ramp = tunnel ? Math.min(1, (progress - tunnel.from) / 60, (tunnel.to - progress) / 60) : 0;
  return { coordinate, bearing: position.bearing, altitude: tunnel ? -tunnel.depthMeters * Math.max(0, ramp) : 0, underground: !!tunnel };
}
