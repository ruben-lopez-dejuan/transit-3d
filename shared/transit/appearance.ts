import type { TransitMode, VehicleAppearance, VehicleBody, VehicleKind, VehicleLivery } from './contracts';
export type StyledVehicle = { mode: TransitMode; appearance?: VehicleAppearance };
export function kindFor(vehicle: StyledVehicle): VehicleKind { return vehicle.appearance?.kind ?? (vehicle.mode === 'rail' ? 'train' : vehicle.mode); }
export function compositionFor(vehicle: StyledVehicle) {
  return vehicle.appearance?.composition ?? (vehicle.mode === 'bus' || vehicle.mode === 'funicular' ? { count: 1, length: 12, gap: 0 } : vehicle.mode === 'tram' ? { count: 3, length: 10, gap: .6 } : { count: 4, length: 17, gap: 1 });
}
/** The fleet's paint when the operator has a known livery; otherwise the line colour with a white band. */
export function liveryFor(vehicle: StyledVehicle & { color: string }): VehicleLivery {
  return vehicle.appearance?.livery ?? { body: vehicle.color, accent: '#ffffff' };
}
const BODIES: Record<VehicleKind, VehicleBody> = {
  bus: { cab: 'flat', doors: 3, width: 2.55, height: 3.2 },
  metro: { cab: 'round', doors: 4, width: 2.8, height: 3.75 },
  train: { cab: 'flat', doors: 3, width: 2.9, height: 3.9 },
  tram: { cab: 'round', doors: 1, width: 2.4, height: 3.3 },
  funicular: { cab: 'cabin', doors: 3, width: 2.6, height: 3.1 },
  unknown: { cab: 'flat', doors: 3, width: 2.8, height: 3.7 },
};
/** The cars' shape when the city package knows the fleet; otherwise a typical one for the kind. */
export function bodyFor(vehicle: StyledVehicle): VehicleBody {
  return vehicle.appearance?.body ?? BODIES[kindFor(vehicle)];
}
