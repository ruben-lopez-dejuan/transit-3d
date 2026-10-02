import type { CityPackage, AdapterVehicle, VehicleAppearance } from '../../shared/transit/contracts';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import type { Departure, Shape, Stop, Place } from '../../shared/transit/network';
import type { UpdatedTrip } from './realtime';
import { RegisteredProvider } from './registeredProvider';

export type StopArrivalsAdapter = {
  departures(gtfs: BizkaibusGtfs, stopId: string): Promise<Departure[]>;
  warm(gtfs: BizkaibusGtfs, stopIds: string[]): Promise<void>;
  peek(gtfs: BizkaibusGtfs, stopId: string, vehicleId?: string | null): { arrival: number; sourceTimestamp: number } | null;
};
export type ProviderRuntime = RegisteredProvider & {
  getGtfs(): Promise<BizkaibusGtfs>;
  getUpdates?(): ReadonlyMap<string, UpdatedTrip>;
  arrivals?: StopArrivalsAdapter;
  appearanceFor?(vehicle: Pick<AdapterVehicle, 'mode' | 'routeId'>, shortName: string): VehicleAppearance;
};
export interface RuntimeCityPackage extends CityPackage {
  readonly providers: readonly ProviderRuntime[];
  places(stops: Stop[]): Place[];
  infrastructure(gtfs: BizkaibusGtfs, providerId: string, shapeId: string): Shape['underground'];
}
