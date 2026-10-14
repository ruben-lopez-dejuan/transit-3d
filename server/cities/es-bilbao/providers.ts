import { getBizkaibusGtfs } from '../../providers/bizkaibus/gtfs';
import { BizkaibusProvider } from '../../providers/bizkaibus/provider';
import { BIZKAIBUS_TRIP_UPDATES_URL } from '../../providers/bizkaibus/config';
import { bizkaibusArrivals } from '../../providers/bizkaibus/arrivals';
import { bilbobusProvider } from '../../providers/bilbobus';
import { renfeProvider } from '../../providers/renfe';
import { StaticGtfsProvider } from '../../providers/staticGtfs';
import { RealtimeProvider } from '../../providers/realtimeProvider';
import { RealtimeFeedClient } from '../../providers/realtimeFeed';
import { RegisteredProvider } from '../../transit/registeredProvider';
import { repairShapes, shapeRepairVersion } from '../../transit/routedSegments';
import type { ProviderRuntime } from '../../transit/cityPackage';
import type { AdapterVehicle, VehicleAppearance, VehicleLivery } from '../../../shared/transit/contracts';
import { entityId } from '../../../shared/transit/ids';
import { bilbaoManifest } from './city.manifest';
import { primary, regionalSources, renfeSource, type Source } from './sources';

export const definitions = bilbaoManifest.providers;
// Some operator shapes are drawn wrong (straight stop-to-stop lines, a detour to a dead end); see routedSegments.ts.
const shapeRepairs = (operatorId: string) => ({ prepare: (gtfs: Parameters<typeof repairShapes>[0]) => { repairShapes(gtfs, operatorId); }, prepareVersion: shapeRepairVersion });
export const staticProviders = [bilbobusProvider, renfeProvider, ...[...primary, ...regionalSources].map((source) => new StaticGtfsProvider(source.id, source.gtfs, { timezone: bilbaoManifest.timezone, ...shapeRepairs(source.id) }))];
export const gtfsLoaders = new Map(staticProviders.map((p) => [p.operatorId, () => p.getGtfs()]));
gtfsLoaders.set('bizkaibus', getBizkaibusGtfs);
const sourceById = new Map<string, Source>([...primary, ...regionalSources, renfeSource].map((s) => [s.id, s]));
export const realtimeProviders = [
  new RealtimeProvider(new BizkaibusProvider(), getBizkaibusGtfs, new RealtimeFeedClient('bizkaibus-tu', BIZKAIBUS_TRIP_UPDATES_URL), undefined, undefined, bilbaoManifest.timezone),
  ...staticProviders.filter((p) => sourceById.get(p.operatorId)?.tripUpdates || sourceById.get(p.operatorId)?.vehiclePositions).map((provider) => {
    const source = sourceById.get(provider.operatorId)!;
    return new RealtimeProvider(provider, () => provider.getGtfs(), source.tripUpdates ? new RealtimeFeedClient(`${provider.operatorId}-tu`, source.tripUpdates) : undefined, source.vehiclePositions ? new RealtimeFeedClient(`${provider.operatorId}-vp`, source.vehiclePositions) : undefined, source.maximumGpsSpeed, bilbaoManifest.timezone);
  }),
];
/** Source adapters stay at their existing paths; this is the Bilbao composition root. */
export const sourceAdapters = [...realtimeProviders, ...staticProviders.filter((p) => !realtimeProviders.some((r) => r.operatorId === p.operatorId))];

/**
 * Fleet paint, not line colour (audited 14 Oct 2026): Metro Bilbao grey with its red-orange,
 * Euskotren blue (trains and trams), Renfe Cercanías white with red, Bilbobus red, Bizkaibus
 * green, Dbus blue, Artxanda funicular red. Operators without a confirmed livery keep the line colour.
 */
const LIVERIES: Record<string, VehicleLivery> = {
  'metro-bilbao': { body: '#c8cfd3', accent: '#e2401c' },
  euskotren: { body: '#1d4e98', accent: '#7db7e5' },
  renfe: { body: '#f2f3f4', accent: '#cf102d' },
  bilbobus: { body: '#c8102e', accent: '#f4f4f4' },
  bizkaibus: { body: '#5da832', accent: '#f4f4f4' },
  dbus: { body: '#1f5aa6', accent: '#f4f4f4' },
  'funicular-artxanda': { body: '#d22b2b', accent: '#f4f4f4' },
};
/**
 * Consists per fleet: Metro Bilbao series 500/550/600 run 4 cars (72 m; 22 of the 46 trains
 * have a fifth car, not identified per trip); Euskotren 950 has 3 cars (L3, Txorierri E3/E3a)
 * and 900 has 4; Bilbao trams (series 400) 3 modules, 24.4 m; Vitoria trams (500) 5 modules,
 * 31.4 m; Renfe Cercanías 446/447, 3 cars.
 */
function consistFor(providerId: string, mode: AdapterVehicle['mode'], shortName: string): VehicleAppearance['composition'] {
  if (mode === 'bus' || mode === 'funicular') return { count: 1, length: 12, gap: 0 };
  if (mode === 'tram') return providerId === 'euskotren' && /^(TG|4\d)/.test(shortName) ? { count: 5, length: 6.1, gap: .2 } : { count: 3, length: 8, gap: .2 };
  if (providerId === 'metro-bilbao') return { count: 4, length: 17.8, gap: .3 };
  if (providerId === 'euskotren') return /^(L3|E3)/.test(shortName) ? { count: 3, length: 19, gap: .4 } : { count: 4, length: 19, gap: .4 };
  if (providerId === 'renfe') return { count: 3, length: 23, gap: 1 };
  return { count: 4, length: 17, gap: 1 };
}
export function bilbaoAppearance(providerId: string, vehicle: Pick<AdapterVehicle, 'mode' | 'routeId'>, shortName: string): VehicleAppearance {
  const kind = vehicle.mode === 'rail' ? providerId === 'metro-bilbao' ? 'metro' : 'train' : vehicle.mode;
  const lateralOffsetMeters = (vehicle.mode === 'rail' || vehicle.mode === 'tram') && !(providerId === 'renfe' && /^C[45]/.test(shortName)) ? 1.7 : 0;
  const livery = LIVERIES[providerId];
  return { kind, composition: consistFor(providerId, vehicle.mode, shortName), lateralOffsetMeters, ...(livery ? { livery } : {}) };
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
    peek: (gtfs, stopId, vehicleId) => { const row = bilbobusProvider.peekArrival(vehicleId, gtfs.stops.get(stopId)?.stopCode ?? ''); return row ? { arrival: row.arrival, departure: row.departure, sourceTimestamp: row.recordedAt } : null; },
  };
  // The open GTFS-RT TripUpdates only repeat the timetable; the official app's passing times are the prediction.
  if (adapter.operatorId === 'bizkaibus') provider.arrivals = {
    departures: async (gtfs, stopId) => (await bizkaibusArrivals.departures(gtfs, stopId)).map(({ routeId, tripId, ...row }) => ({ ...row, routeKey: entityId(bilbaoManifest.id, adapter.operatorId, 'route', routeId), tripId: entityId(bilbaoManifest.id, adapter.operatorId, 'trip', tripId) })),
    warm: async (gtfs, stopIds) => { await Promise.allSettled(stopIds.map((id) => bizkaibusArrivals.get(gtfs, id))); },
    peek: (_gtfs, stopId, vehicleId) => { const row = bizkaibusArrivals.peek(stopId, vehicleId); return row ? { arrival: row.arrival, sourceTimestamp: row.recordedAt } : null; },
  };
  return provider;
});
