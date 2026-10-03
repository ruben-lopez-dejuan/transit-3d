import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CityManifest, SourceAdapter } from '../../shared/transit/contracts';
import { compositionFor, kindFor } from '../../shared/transit/appearance';
import { StaticGtfsProvider } from '../providers/staticGtfs';
import { RealtimeProvider } from '../providers/realtimeProvider';
import { RealtimeFeedClient } from '../providers/realtimeFeed';
import { RegisteredProvider } from '../transit/registeredProvider';
import type { ProviderRuntime, RuntimeCityPackage } from '../transit/cityPackage';
import type { ProviderRegistry } from '../transit/registry';
import { parseCityPackage, type CityPackageConfig } from './packageConfig';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import type { StopArrivalsAdapter } from '../transit/cityPackage';
import type { UpdatedTrip } from '../transit/realtime';
import { madridExtensions } from './es-madrid';

/** Trusted backend extensions; packages remain data-only and API 1 is unchanged. */
export type ProviderExtension = {
  cacheVersion: string;
  capabilities?: Partial<CityManifest['providers'][number]['capabilities']>;
  prepareGtfs?(gtfs: BizkaibusGtfs): void | Promise<void>;
  create(context: { base: StaticGtfsProvider; getGtfs: () => Promise<BizkaibusGtfs>; timetable?: RealtimeFeedClient; gps?: RealtimeFeedClient; timezone: string; maximumGpsSpeed?: number }): { adapter: SourceAdapter; getUpdates?: () => ReadonlyMap<string, UpdatedTrip>; arrivals?: StopArrivalsAdapter };
};

export function createFolderCity(config: CityPackageConfig, extensions: ReadonlyMap<string, ProviderExtension> = new Map()): RuntimeCityPackage {
  const manifest: CityManifest = { ...config, providers: config.providers.map((provider) => ({
    id: provider.id, name: provider.name, color: provider.color, primary: provider.primary, group: provider.group,
    realtime: !!(provider.sources.tripUpdates || provider.sources.vehiclePositions || extensions.get(provider.id)?.capabilities?.stopArrivals),
    capabilities: { staticGtfs: true, vehiclePositions: !!provider.sources.vehiclePositions, tripUpdates: !!provider.sources.tripUpdates,
      serviceAlerts: false, occupancy: false, speed: false, bearing: false, stopArrivals: false, ...extensions.get(provider.id)?.capabilities },
  })) };
  const providers = config.providers.map((settings, index) => {
    // Include the configuration in the cache identity: changed route filters/URLs cannot reuse another feed.
    const extension = extensions.get(settings.id);
    const hash = createHash('sha256').update(JSON.stringify(settings) + (extension?.cacheVersion ?? '')).digest('hex');
    const routeIds = settings.routeIds ? new Set(settings.routeIds) : null;
    const base = new StaticGtfsProvider(settings.id, settings.sources.gtfs, {
      timezone: config.timezone, cacheNamespace: `${config.id}-${hash}`,
      includeRoute: routeIds ? (route) => routeIds.has(route.routeId) : undefined,
      prepare: async (gtfs) => {
        if (routeIds) for (const id of routeIds) if (!gtfs.routes.has(id)) throw new Error(`routeId no encontrado en GTFS: ${id}`);
        // Keep only geometry and stops referenced by selected trips, especially for national feeds.
        const shapes = new Set([...gtfs.trips.values()].map((trip) => trip.shapeId));
        const stops = new Set([...gtfs.tripStops.values()].flatMap((times) => times.map((stop) => stop.stopId)));
        for (const id of gtfs.shapes.keys()) if (!shapes.has(id)) gtfs.shapes.delete(id);
        for (const id of gtfs.stops.keys()) if (!stops.has(id)) gtfs.stops.delete(id);
        await extension?.prepareGtfs?.(gtfs);
      },
    });
    const cacheName = `${config.id}__${settings.id}__${hash}`;
    const timetable = settings.sources.tripUpdates ? new RealtimeFeedClient(cacheName + '__tu', settings.sources.tripUpdates) : undefined;
    const gps = settings.sources.vehiclePositions ? new RealtimeFeedClient(cacheName + '__vp', settings.sources.vehiclePositions) : undefined;
    const custom = extension?.create({ base, getGtfs: () => base.getGtfs(), timetable, gps, timezone: config.timezone, maximumGpsSpeed: settings.maximumGpsSpeed });
    const realtime = !custom && (timetable || gps) ? new RealtimeProvider(base, () => base.getGtfs(), timetable, gps,
      settings.maximumGpsSpeed, config.timezone) : undefined;
    const provider = new RegisteredProvider(manifest, manifest.providers[index], custom?.adapter ?? realtime ?? base) as ProviderRuntime;
    provider.getGtfs = () => base.getGtfs();
    if (realtime) provider.getUpdates = () => realtime.updates;
    if (custom?.getUpdates) provider.getUpdates = custom.getUpdates;
    if (custom?.arrivals) provider.arrivals = custom.arrivals;
    provider.appearanceFor = ({ mode }) => settings.appearance ?? ({ kind: kindFor({ mode }), composition: compositionFor({ mode }), lateralOffsetMeters: mode === 'rail' || mode === 'tram' ? 1.7 : 0 });
    return provider;
  });
  return { manifest, providers, places: () => [], infrastructure: () => [] };
}
export type PackageReport = { directory: string; cityId?: string; state: 'loaded' | 'invalid'; error?: string };
export function loadFolderCities(registry: ProviderRegistry<RuntimeCityPackage>, directory = path.resolve('city-packages')): PackageReport[] {
  if (!fs.existsSync(directory)) return [];
  const reports: PackageReport[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    let config: CityPackageConfig | undefined;
    try {
      if (entry.isSymbolicLink()) throw new Error('No se admiten carpetas enlazadas');
      const file = path.join(directory, entry.name, 'city.json');
      if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.statSync(file).size > 1_048_576) throw new Error('city.json debe ser un archivo regular de hasta 1 MiB');
      config = parseCityPackage(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (config.id !== entry.name) throw new Error('La carpeta debe tener el mismo nombre que city.id');
      registry.register(createFolderCity(config, config.id === 'es-madrid' ? madridExtensions(config) : undefined));
      reports.push({ directory: entry.name, cityId: config.id, state: 'loaded' });
    } catch (error) { reports.push({ directory: entry.name, cityId: config?.id, state: 'invalid', error: error instanceof Error ? error.message : String(error) }); }
  }
  return reports;
}
