import sources from './moveuskadi-sources.json';
import { getBizkaibusGtfs } from './bizkaibus/gtfs';
import { BizkaibusProvider } from './bizkaibus/provider';
import { bilbobusProvider } from './bilbobus';
import { renfeProvider } from './renfe';
import { StaticGtfsProvider } from './staticGtfs';
import { RealtimeProvider } from './realtimeProvider';
import { RealtimeFeedClient } from './realtimeFeed';

export type ProviderDefinition = { id: string; name: string; color: string; realtime: boolean; group?: string };
type Source = { id: string; name: string; color: string; gtfs: string; tripUpdates?: string; vehiclePositions?: string };
const primary: Source[] = [
  { id: 'metro-bilbao', name: 'Metro Bilbao', color: '#d95038', gtfs: 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip', tripUpdates: 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfsrt_metro_bilbao_trip_updates.pb' },
  { id: 'euskotren', name: 'Euskotren', color: '#3275a6', gtfs: 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip', tripUpdates: 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfsrt_euskotren_trip_updates.pb' },
];
export const definitions: ProviderDefinition[] = [
  { id: 'bizkaibus', name: 'Bizkaibus', color: '#177857', realtime: true },
  { id: 'bilbobus', name: 'Bilbobus', color: '#c33b42', realtime: true },
  ...primary.map((s) => ({ id: s.id, name: s.name, color: s.color, realtime: true })),
  { id: 'renfe', name: 'Renfe Cercanías', color: '#be1747', realtime: true },
  ...sources.map((s) => ({ id: s.id, name: s.name, color: s.color, realtime: !!s.tripUpdates || !!s.vehiclePositions, group: s.name.includes('Lurraldebus') ? 'Lurraldebus' : 'Otros' })),
];
export const staticProviders = [bilbobusProvider, renfeProvider, ...[...primary, ...sources].map((source) => new StaticGtfsProvider(source.id, source.gtfs))];
export const gtfsLoaders = new Map(staticProviders.map((p) => [p.operatorId, () => p.getGtfs()]));
gtfsLoaders.set('bizkaibus', getBizkaibusGtfs);
const sourceById = new Map<string, Source>([...primary, ...sources, { id: 'renfe', name: 'Renfe', color: '#be1747', gtfs: '', tripUpdates: 'https://gtfsrt.renfe.com/trip_updates.pb', vehiclePositions: 'https://gtfsrt.renfe.com/vehicle_positions.pb' }].map((s) => [s.id, s]));
export const realtimeProviders = [
  new RealtimeProvider(new BizkaibusProvider(), getBizkaibusGtfs, new RealtimeFeedClient('bizkaibus-tu', 'https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_bizkaibus_trip_updates.pb')),
  ...staticProviders.filter((p) => sourceById.get(p.operatorId)?.tripUpdates || sourceById.get(p.operatorId)?.vehiclePositions).map((provider) => {
    const source = sourceById.get(provider.operatorId)!;
    return new RealtimeProvider(provider, () => provider.getGtfs(), source.tripUpdates ? new RealtimeFeedClient(`${provider.operatorId}-tu`, source.tripUpdates) : undefined, source.vehiclePositions ? new RealtimeFeedClient(`${provider.operatorId}-vp`, source.vehiclePositions) : undefined);
  }),
];
export const providers = [...realtimeProviders, ...staticProviders.filter((p) => !realtimeProviders.some((r) => r.operatorId === p.operatorId))];
