import type { AdapterVehicle, NormalizedVehicle, PositionSource, TransitMode } from './contracts';
import type { Vehicle } from './network';

export type TransitDebugObservation = {
  capturedAt: number;
  adapterFetchedAt: number;
  sourceTimestamp: number | null;
  receivedTimestamp: number | null;
  adapterProgress: number;
  normalizedProgress: number | null;
  presentedProgress: number | null;
  latitude: number;
  longitude: number;
  positionSource: PositionSource | null;
};

export type TransitDebugTrace = {
  cityId: string;
  providerId: string;
  vehicleId: string;
  generatedAt: number;
  adapter: AdapterVehicle | null;
  normalized: NormalizedVehicle | null;
  presentation: Vehicle | null;
  history: TransitDebugObservation[];
};

export type TransitDebugVehicleSummary = {
  id: string;
  providerId: string;
  operatorName: string;
  mode: TransitMode;
  routeShortName: string;
  destination: string;
  positionSource: PositionSource;
  sourceTimestamp: number | null;
  receivedTimestamp: number | null;
};
