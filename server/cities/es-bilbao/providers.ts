import { getBizkaibusGtfs } from '../../providers/bizkaibus/gtfs';
import { BizkaibusProvider } from '../../providers/bizkaibus/provider';
import { bilbobusProvider } from '../../providers/bilbobus';
import { renfeProvider } from '../../providers/renfe';
import { StaticGtfsProvider } from '../../providers/staticGtfs';
import { RealtimeProvider } from '../../providers/realtimeProvider';
import { RealtimeFeedClient } from '../../providers/realtimeFeed';
import { RegisteredProvider } from '../../transit/registeredProvider';
import type { ProviderRuntime } from '../../transit/cityPackage';
import type { AdapterVehicle, VehicleAppearance } from '../../../shared/transit/contracts';
import { entityId } from '../../../shared/transit/ids';
import { bilbaoManifest } from './city.manifest';
import { primary, regionalSources, renfeSource, type Source } from './sources';

export const definitions = bilbaoManifest.providers;
export const staticProviders = [bilbobusProvider, renfeProvider, ...[...primary, ...regionalSources].map((source) => new StaticGtfsProvider(source.id, source.gtfs))];
export const gtfsLoaders = new Map(staticProviders.map((p) => [p.operatorId, () => p.getGtfs()]));
gtfsLoaders.set('bizkaibus', getBizkaibusGtfs);
const sourceById = new Map<string, Source>([...primary, ...regionalSources, renfeSource].map((s) => [s.id, s]));
export const realtimeProviders = [
  new RealtimeProvider(new BizkaibusProvider(), getBizkaibusGtfs, new RealtimeFeedClient('bizkaibus-tu', 'https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_bizkaibus_trip_updates.pb')),
  ...staticProviders.filter((p) => sourceById.get(p.operatorId)?.tripUpdates || sourceById.get(p.operatorId)?.vehiclePositions).map((provider) => {
    const source = sourceById.get(provider.operatorId)!;
    return new RealtimeProvider(provider, () => provider.getGtfs(), source.tripUpdates ? new RealtimeFeedClient(`${provider.operatorId}-tu`, source.tripUpdates) : undefined, source.vehiclePositions ? new RealtimeFeedClient(`${provider.operatorId}-vp`, source.vehiclePositions) : undefined, source.maximumGpsSpeed);
  }),
];
/** Source adapters stay at their existing paths; this is the Bilbao composition root. */
export const sourceAdapters = [...realtimeProviders, ...staticProviders.filter((p) => !realtimeProviders.some((r) => r.operatorId === p.operatorId))];

export function bilbaoAppearance(providerId: string, vehicle: Pick<AdapterVehicle, 'mode' | 'routeId'>, shortName: string): VehicleAppearance {
  const kind = vehicle.mode === 'rail' ? providerId === 'metro-bilbao' ? 'metro' : 'train' : vehicle.mode;
  const composition = vehicle.mode === 'bus' || vehicle.mode === 'funicular' ? { count: 1, length: 12, gap: 0 } : vehicle.mode === 'tram' ? { count: 3, length: 10, gap: .6 } : providerId === 'renfe' ? { count: 3, length: 23, gap: 1 } : { count: 4, length: 17, gap: 1 };
  const lateralOffsetMeters = (vehicle.mode === 'rail' || vehicle.mode === 'tram') && !(providerId === 'renfe' && /^C[45]/.test(shortName)) ? 1.7 : 0;
  return { kind, composition, lateralOffsetMeters };
}
export const providers: ProviderRuntime[] = sourceAdapters.map((adapter) => {
  const provider = new RegisteredProvider(bilbaoManifest, definitions.find((d) => d.id === adapter.operatorId)!, adapter) as ProviderRuntime;
  provider.getGtfs = gtfsLoaders.get(adapter.operatorId)!;
  const realtime = realtimeProviders.find((p) => p.operatorId === adapter.operatorId);
  if (realtime) provider.getUpdates = () => realtime.updates;
  provider.appearanceFor = (vehicle, shortName) => bilbaoAppearance(adapter.operatorId, vehicle, shortName);
  if (adapter.operatorId === 'bilbobus') provider.arrivals = {
    departures: async (gtfs, stopId) => (await bilbobusProvider.departures(gtfs, gtfs.stops.get(stopId)?.stopCode ?? '')).map((row) => ({ ...row, routeKey: entityId(bilbaoManifest.id, adapter.operatorId, 'route', row.routeKey.slice('bilbobus:'.length)), tripId: entityId(bilbaoManifest.id, adapter.operatorId, 'trip', row.tripId) })),
    warm: async (gtfs, stopIds) => { await Promise.allSettled(stopIds.map((id) => bilbobusProvider.getArrivals(gtfs.stops.get(id)?.stopCode ?? ''))); },
    peek: (gtfs, stopId, vehicleId) => { const row = bilbobusProvider.peekArrival(vehicleId, gtfs.stops.get(stopId)?.stopCode ?? ''); return row ? { arrival: row.arrival, sourceTimestamp: row.recordedAt } : null; },
  };
  return provider;
});
