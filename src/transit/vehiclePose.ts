import type { Shape, Vehicle } from './networkTypes';
import { positionAlong } from './motion';
import { compositionFor, type StyledVehicle } from '../../shared/transit/appearance';

export const composition = compositionFor;
/** Each car samples the track separately; offsets are a diagrammatic separation. */
export function vehiclePose(shape: Shape, progress: number, vehicle: StyledVehicle, lateralScale = 1) {
  const position = positionAlong(shape, progress); if (!position) return null;
  const rail = vehicle.mode === 'rail' || vehicle.mode === 'tram';
  const lateral = (vehicle.appearance?.lateralOffsetMeters ?? (rail ? 1.7 : 0)) * lateralScale;
  const angle = position.bearing * Math.PI / 180;
  const coordinate: [number, number] = [position.coordinate[0] + lateral * Math.cos(angle) / (111320 * Math.cos(position.coordinate[1] * Math.PI / 180)), position.coordinate[1] - lateral * Math.sin(angle) / 110540];
  const tunnel = shape.underground?.find((s) => progress >= s.from && progress <= s.to);
  const ramp = tunnel ? Math.min(1, (progress - tunnel.from) / 60, (tunnel.to - progress) / 60) : 0;
  return { coordinate, bearing: position.bearing, altitude: tunnel ? -tunnel.depthMeters * Math.max(0, ramp) : 0, underground: !!tunnel };
}
