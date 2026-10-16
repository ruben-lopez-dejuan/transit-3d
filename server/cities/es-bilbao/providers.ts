import { getBizkaibusGtfs } from '../../providers/bizkaibus/gtfs';
import { BizkaibusProvider } from '../../providers/bizkaibus/provider';
import { BIZKAIBUS_TRIP_UPDATES_URL } from '../../providers/bizkaibus/config';
import { bizkaibusArrivals } from '../../providers/bizkaibus/arrivals';
import { bilbobusProvider } from '../../providers/bilbobus';
import { renfeProvider } from '../../providers/renfe';
import { StaticGtfsProvider } from '../../providers/staticGtfs';
import { RealtimeProvider } from '../../providers/realtimeProvider';
import { RealtimeFeedClient } from '../../providers/realtimeFeed';
import type { RealtimeMessage, StopUpdate } from '../../transit/realtime';
import { RegisteredProvider } from '../../transit/registeredProvider';
import { repairShapes, shapeRepairVersion } from '../../transit/routedSegments';
import type { ProviderRuntime } from '../../transit/cityPackage';
import type { AdapterVehicle, VehicleAppearance, VehicleBody, VehicleLivery } from '../../../shared/transit/contracts';
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
const repairedMetroFeeds = new WeakMap<RealtimeMessage, RealtimeMessage>();
const isUrduliz = (updates: StopUpdate[], i: number) => updates[i].stopId === '20.0' && [updates[i - 1]?.stopId, updates[i + 1]?.stopId].some((id) => id === '28.0' || id === '30.0');
/**
 * Metro Bilbao's TripUpdates call Urduliz (29.0) by Gobela's id, 20.0 (15 Oct 2026: 29.0 never
 * appears, and 20.0 shows up both between Areeta and Neguri and between Sopela and Plentzia).
 * Out of order, that stop made every Plentzia train fall back to the timetable. A 20.0 next to
 * Sopela (28.0) or Plentzia (30.0) can only be Urduliz; Gobela is left as is.
 */
export function repairMetroBilbaoStops(feed: RealtimeMessage | null): RealtimeMessage | null {
  if (!feed) return feed;
  const cached = repairedMetroFeeds.get(feed); if (cached) return cached;
  const repaired = { ...feed, entity: feed.entity?.map((entity) => {
    const updates = entity.tripUpdate?.stopTimeUpdate;
    if (!updates?.some((_, i) => isUrduliz(updates, i))) return entity;
    const stopTimeUpdate = updates.map((update, i) => isUrduliz(updates, i) ? { ...update, stopId: '29.0' } : update);
    return { ...entity, tripUpdate: { ...entity.tripUpdate!, stopTimeUpdate } };
  }) };
  repairedMetroFeeds.set(feed, repaired);
  return repaired;
}
export const realtimeProviders = [
  new RealtimeProvider(new BizkaibusProvider(), getBizkaibusGtfs, new RealtimeFeedClient('bizkaibus-tu', BIZKAIBUS_TRIP_UPDATES_URL), undefined, undefined, bilbaoManifest.timezone),
  ...staticProviders.filter((p) => sourceById.get(p.operatorId)?.tripUpdates || sourceById.get(p.operatorId)?.vehiclePositions).map((provider) => {
    const source = sourceById.get(provider.operatorId)!;
    return new RealtimeProvider(provider, () => provider.getGtfs(), source.tripUpdates ? new RealtimeFeedClient(`${provider.operatorId}-tu`, source.tripUpdates) : undefined, source.vehiclePositions ? new RealtimeFeedClient(`${provider.operatorId}-vp`, source.vehiclePositions) : undefined, source.maximumGpsSpeed, bilbaoManifest.timezone, provider.operatorId === 'metro-bilbao' ? (_gtfs, feed) => repairMetroBilbaoStops(feed) : undefined);
  }),
];
/** Source adapters stay at their existing paths; this is the Bilbao composition root. */
export const sourceAdapters = [...realtimeProviders, ...staticProviders.filter((p) => !realtimeProviders.some((r) => r.operatorId === p.operatorId))];

/**
 * Fleet paint, not line colour, after photos of each fleet: Metro Bilbao grey with a low
 * red-orange band and a dark nose; Euskotren trains white with a broad blue lower half and a
 * deep blue mask, recalling its historic blue trains; the Bilbao/Vitoria tram white with green
 * below; Renfe Cercanías white with a red cab and low red band; Bizkaibus white with its green
 * lower waves; Bilbobus red; Dbus blue; Artxanda funicular red. Others keep the line colour.
 */
const LIVERIES: Record<string, VehicleLivery> = {
  'metro-bilbao': { body: '#c6ccd1', accent: '#e5521f', front: '#2b3035', band: 'skirt' },
  euskotren: { body: '#f1f3f5', accent: '#1f5fae', front: '#173f7a', band: 'broad' },
  'euskotren:tram': { body: '#f1f3f1', accent: '#63b33f', front: '#24292d', band: 'broad' },
  renfe: { body: '#f2f3f4', accent: '#cf102d', front: '#cf102d', band: 'skirt' },
  bilbobus: { body: '#d71a21', accent: '#f4f4f4', band: 'thin' },
  bizkaibus: { body: '#f2f4f1', accent: '#3fa93a', band: 'broad' },
  dbus: { body: '#1f5aa6', accent: '#f4f4f4', band: 'thin' },
  'funicular-artxanda': { body: '#d22b2b', accent: '#f4f4f4', band: 'thin' },
};
/**
 * The cars' shape, after the same photos and the fleets' data sheets: Metro Bilbao (CAF 500/550/600)
 * 2.8 m wide with a front rounded in plan and four doors a side; Euskotren 900/950 2.6 m wide and
 * 3.6 m tall, with a long raked nose and three doors; Renfe Cercanías 446/447 2.94 m wide with an
 * upright cab and three doors; the CAF Urbos trams 2.4 m wide, rounded, a door per module; the
 * Artxanda funicular a glazed cabin at both ends.
 */
const BODIES: Record<string, VehicleBody> = {
  'metro-bilbao': { cab: 'round', doors: 4, width: 2.8, height: 3.75 },
  euskotren: { cab: 'sloped', doors: 3, width: 2.6, height: 3.6 },
  'euskotren:tram': { cab: 'round', doors: 1, width: 2.4, height: 3.3 },
  renfe: { cab: 'flat', doors: 3, width: 2.94, height: 3.95 },
  'funicular-artxanda': { cab: 'cabin', doors: 3, width: 2.6, height: 3.1 },
};
/**
 * Consists per fleet: Metro Bilbao series 500 runs 4 cars (72 m) and series 550/600 five, told
 * apart by the unit its TripUpdates name; Euskotren 950 has 3 cars (L3, Txorierri E3/E3a)
 * and 900 has 4; Bilbao trams (series 400) 3 modules, 24.4 m; Vitoria trams (500) 5 modules,
 * 31.4 m; Renfe Cercanías 446/447, 3 cars.
 */
function consistFor(providerId: string, mode: AdapterVehicle['mode'], shortName: string, unit?: string | null): VehicleAppearance['composition'] {
  if (mode === 'bus' || mode === 'funicular') return { count: 1, length: 12, gap: 0 };
  if (mode === 'tram') return providerId === 'euskotren' && /^(TG|4\d)/.test(shortName) ? { count: 5, length: 6.1, gap: .2 } : { count: 3, length: 8, gap: .2 };
  // Units 551–563 (series 550) and 601–609 (series 600) run five cars: the 22 five-car trains of the 46.
  if (providerId === 'metro-bilbao') return { count: /^(55[1-9]|56[0-3]|60[1-9])$/.test(unit ?? '') ? 5 : 4, length: 17.8, gap: .3 };
  if (providerId === 'euskotren') return /^(L3|E3)/.test(shortName) ? { count: 3, length: 19, gap: .4 } : { count: 4, length: 19, gap: .4 };
  if (providerId === 'renfe') return { count: 3, length: 23, gap: 1 };
  return { count: 4, length: 17, gap: 1 };
}
export function bilbaoAppearance(providerId: string, vehicle: Pick<AdapterVehicle, 'mode' | 'routeId'>, shortName: string, unit?: string | null): VehicleAppearance {
  const kind = vehicle.mode === 'rail' ? providerId === 'metro-bilbao' ? 'metro' : 'train' : vehicle.mode;
  // Euskotren tram shapes are matched onto their own OSM track (trackMatching.ts): no diagrammatic offset.
  const lateralOffsetMeters = (vehicle.mode === 'rail' || vehicle.mode === 'tram') && !(providerId === 'renfe' && /^C[45]/.test(shortName)) && !(providerId === 'euskotren' && vehicle.mode === 'tram') ? 1.7 : 0;
  const livery = LIVERIES[`${providerId}:${vehicle.mode}`] ?? LIVERIES[providerId];
  const body = BODIES[`${providerId}:${vehicle.mode}`] ?? BODIES[providerId];
  return { kind, composition: consistFor(providerId, vehicle.mode, shortName, unit), lateralOffsetMeters, ...(livery ? { livery } : {}), ...(body ? { body } : {}) };
}
export const providers: ProviderRuntime[] = sourceAdapters.map((adapter) => {
  const provider = new RegisteredProvider(bilbaoManifest, definitions.find((d) => d.id === adapter.operatorId)!, adapter) as ProviderRuntime;
  provider.getGtfs = gtfsLoaders.get(adapter.operatorId)!;
  const realtime = realtimeProviders.find((p) => p.operatorId === adapter.operatorId);
  if (realtime) provider.getUpdates = () => realtime.updates;
  provider.appearanceFor = (vehicle, shortName, unit) => bilbaoAppearance(adapter.operatorId, vehicle, shortName, unit);
  if (adapter.operatorId === 'bilbobus') provider.arrivals = {
    departures: async (gtfs, stopId) => (await bilbobusProvider.departures(gtfs, gtfs.stops.get(stopId)?.stopCode ?? '')).map((row) => ({ ...row, routeKey: entityId(bilbaoManifest.id, adapter.operatorId, 'route', row.routeKey.slice('bilbobus:'.length)), tripId: entityId(bilbaoManifest.id, adapter.operatorId, 'trip', row.tripId) })),
    warm: async (gtfs, stopIds) => { await Promise.allSettled(stopIds.map((id) => bilbobusProvider.getArrivals(gtfs.stops.get(id)?.stopCode ?? ''))); },
    peek: (gtfs, stopId, vehicleId) => { const row = bilbobusProvider.peekArrival(vehicleId, gtfs.stops.get(stopId)?.stopCode ?? ''); return row ? { arrival: row.arrival, departure: row.departure, sourceTimestamp: row.recordedAt, distanceMeters: row.distance === null ? undefined : Math.max(0, row.distance) } : null; },
  };
  // The open GTFS-RT TripUpdates only repeat the timetable; the official app's passing times are the prediction.
  if (adapter.operatorId === 'bizkaibus') provider.arrivals = {
    departures: async (gtfs, stopId) => (await bizkaibusArrivals.departures(gtfs, stopId)).map(({ routeId, tripId, ...row }) => ({ ...row, routeKey: entityId(bilbaoManifest.id, adapter.operatorId, 'route', routeId), tripId: entityId(bilbaoManifest.id, adapter.operatorId, 'trip', tripId) })),
    warm: async (gtfs, stopIds) => { await Promise.allSettled(stopIds.map((id) => bizkaibusArrivals.get(gtfs, id))); },
    peek: (_gtfs, stopId, vehicleId) => { const row = bizkaibusArrivals.peek(stopId, vehicleId); return row ? { arrival: row.arrival, sourceTimestamp: row.recordedAt, distanceMeters: row.meters } : null; },
  };
  return provider;
});
