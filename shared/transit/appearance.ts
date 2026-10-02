import type { TransitMode, VehicleAppearance, VehicleKind } from './contracts';
export type StyledVehicle = { mode: TransitMode; appearance?: VehicleAppearance };
export function kindFor(vehicle: StyledVehicle): VehicleKind { return vehicle.appearance?.kind ?? (vehicle.mode === 'rail' ? 'train' : vehicle.mode); }
export function compositionFor(vehicle: StyledVehicle) {
  return vehicle.appearance?.composition ?? (vehicle.mode === 'bus' || vehicle.mode === 'funicular' ? { count: 1, length: 12, gap: 0 } : vehicle.mode === 'tram' ? { count: 3, length: 10, gap: .6 } : { count: 4, length: 17, gap: 1 });
}
