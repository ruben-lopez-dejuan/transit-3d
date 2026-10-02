import { composition } from '../transit/vehiclePose';
import { kindFor, type StyledVehicle } from '../../shared/transit/appearance';
import type { VehicleKind } from '../../shared/transit/contracts';

export type { VehicleKind };
export const MODEL_MIN_ZOOM = 11;
export const MODEL_DETAIL_ZOOM = 14;
export const MODEL_FULL_ZOOM = 16;
export const MODEL_CAPACITY = 4096;

/** Branding and consist metadata come from the city package. */
export const vehicleKind = kindFor;

export function modelLevel(zoom: number) {
  return zoom < MODEL_MIN_ZOOM ? 'cluster' : zoom < MODEL_DETAIL_ZOOM ? 'silhouette' : zoom < MODEL_FULL_ZOOM ? 'simplified' : 'detailed';
}

/** One owner for the visible fleet. Capacity concerns prepared, visible cars only. */
export function representation(zoom: number, ready: boolean, visibleCars: number): 'model' | 'icon' {
  return zoom >= MODEL_MIN_ZOOM && ready && visibleCars <= MODEL_CAPACITY ? 'model' : 'icon';
}

export function vehicleScale(vehicle: StyledVehicle, zoom: number, latitude: number) {
  const kind = vehicleKind(vehicle), consist = composition(vehicle);
  const totalLength = consist.count * consist.length + (consist.count - 1) * consist.gap;
  const minimumLength = { bus: 18, train: 36, metro: 28, tram: 30, funicular: 16, unknown: 16 }[kind];
  const width = kind === 'bus' ? 2.55 : kind === 'tram' ? 2.4 : 2.7;
  const metersPerPixel = 40075016.686 * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
  const length = Math.max(1, minimumLength * metersPerPixel / totalLength);
  const breadth = Math.max(1, 5 * metersPerPixel / width);
  return { length, width: breadth, height: Math.sqrt(length * breadth) };
}
