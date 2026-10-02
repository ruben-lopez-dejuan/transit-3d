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

export function createFolderCity(config: CityPackageConfig): RuntimeCityPackage {
  const manifest: CityManifest = { ...config, providers: config.providers.map((provider) => ({
    id: provider.id, name: provider.name, color: provider.color, primary: provider.primary, group: provider.group,
    realtime: !!(provider.sources.tripUpdates || provider.sources.vehiclePositions),
    capabilities: { staticGtfs: true, vehiclePositions: !!provider.sources.vehiclePositions, tripUpdates: !!provider.sources.tripUpdates,
      serviceAlerts: false, occupancy: false, speed: false, bearing: false, stopArrivals: false },
  })) };
  const providers = config.providers.map((settings, index) => {
    // Include the configuration in the cache identity: changed route filters/URLs cannot reuse another feed.
    const hash = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const routeIds = settings.routeIds ? new Set(settings.routeIds) : null;
    const base = new StaticGtfsProvider(settings.id, settings.sources.gtfs, {
      timezone: config.timezone, cacheNamespace: `${config.id}-${hash}`,
      includeRoute: routeIds ? (route) => routeIds.has(route.routeId) : undefined,
      prepare: (gtfs) => {
        if (routeIds) for (const id of routeIds) if (!gtfs.routes.has(id)) throw new Error(`routeId no encontrado en GTFS: ${id}`);
        // Keep only geometry and stops referenced by selected trips, especially for national feeds.
        const shapes = new Set([...gtfs.trips.values()].map((trip) => trip.shapeId));
        const stops = new Set([...gtfs.tripStops.values()].flatMap((times) => times.map((stop) => stop.stopId)));
        for (const id of gtfs.shapes.keys()) if (!shapes.has(id)) gtfs.shapes.delete(id);
        for (const id of gtfs.stops.keys()) if (!stops.has(id)) gtfs.stops.delete(id);
      },
    });
    const cacheName = `${config.id}__${settings.id}__${hash}`;
    const realtime = manifest.providers[index].realtime ? new RealtimeProvider(base, () => base.getGtfs(),
      settings.sources.tripUpdates ? new RealtimeFeedClient(cacheName + '__tu', settings.sources.tripUpdates) : undefined,
      settings.sources.vehiclePositions ? new RealtimeFeedClient(cacheName + '__vp', settings.sources.vehiclePositions) : undefined,
      settings.maximumGpsSpeed, config.timezone) : undefined;
    const provider = new RegisteredProvider(manifest, manifest.providers[index], (realtime ?? base) as SourceAdapter) as ProviderRuntime;
    provider.getGtfs = () => base.getGtfs();
    if (realtime) provider.getUpdates = () => realtime.updates;
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
      registry.register(createFolderCity(config));
      reports.push({ directory: entry.name, cityId: config.id, state: 'loaded' });
    } catch (error) { reports.push({ directory: entry.name, cityId: config?.id, state: 'invalid', error: error instanceof Error ? error.message : String(error) }); }
  }
  return reports;
}
