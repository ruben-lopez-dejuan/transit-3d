import type { CityPackageConfig } from '../packageConfig';
import type { ProviderExtension } from '../folderPackage';
import { RealtimeProvider } from '../../providers/realtimeProvider';
import { RenfeAddedTrips } from '../../providers/madrid/renfeAddedTrips';
import { orientTripShapes } from '../../transit/shapeOrientation';
import { MetroFeedClient } from '../../providers/madrid/metroFeed';
import { MetroArrivalProvider } from '../../providers/madrid/metroProvider';
import { completeMetroTopology } from '../../providers/madrid/metroTopology';
import { EmtArrivalProvider, EmtClient } from '../../providers/madrid/emt';

/** Code-owned extensions for Madrid. No executable fields are added to API 1 JSON. */
export function madridExtensions(config: CityPackageConfig): ReadonlyMap<string, ProviderExtension> {
  const extensions = new Map<string, ProviderExtension>();
  const metroFeed = new MetroFeedClient(); // Shared by Metro and the verified ML1 boards.
  for (const provider of config.providers) {
    const metro = provider.id === 'metro-madrid', lightRail = provider.id === 'metro-ligero-crtm';
    if (!metro && !lightRail) continue;
    extensions.set(provider.id, {
      cacheVersion: 'madrid-teleindicadores-topology-v3',
      ...(metro ? { filterActiveServices: false } : {}),
      ...(metro ? { prepareGtfs: async (gtfs) => { try { await completeMetroTopology(gtfs); } catch { console.warn('[metro-madrid] Topología de L3 no disponible; continúan las otras líneas.'); } } } : {}),
      capabilities: { stopArrivals: true, ...(metro ? { scheduledService: false } : {}) },
      create: ({ base, getGtfs }) => {
        const lines = metro ? new Map([['0', 'R'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])]) : new Map([['51', 'ML1']]);
        const adapter = new MetroArrivalProvider(provider.id, getGtfs, metroFeed, lines, config.id, lightRail ? base : undefined);
        return { adapter, arrivals: adapter.arrivals };
      },
    });
  }
  const renfe = config.providers.find((p) => p.id === 'cercanias-renfe');
  if (renfe) {
    const allowed = new Set(renfe.routeIds ?? []);
    if (!allowed.size || [...allowed].some((id) => !/^10T/.test(id))) throw new Error('Cercanías Madrid requiere routeIds explícitos del núcleo 10');
    const added = new RenfeAddedTrips(allowed, config.timezone);
    extensions.set(renfe.id, {
      cacheVersion: 'renfe-madrid-oriented-v1', prepareGtfs: (gtfs) => { orientTripShapes(gtfs); },
      create: ({ base, getGtfs, timetable, gps, timezone, maximumGpsSpeed }) => {
        const adapter = new RealtimeProvider(base, getGtfs, timetable, gps, maximumGpsSpeed ?? 40, timezone, added.prepare);
        return { adapter, getUpdates: () => adapter.updates };
      },
    });
  }
  if (config.providers.some((p) => p.id === 'emt-madrid')) {
    const client = new EmtClient(process.env.EMT_CLIENT_ID && process.env.EMT_PASSKEY ? { clientId: process.env.EMT_CLIENT_ID, passKey: process.env.EMT_PASSKEY } : undefined);
    extensions.set('emt-madrid', { cacheVersion: 'emt-arrivals-v1', capabilities: { stopArrivals: client.configured }, create: ({ base }) => {
      const adapter = new EmtArrivalProvider('emt-madrid', base, client, config.id);
      return { adapter, ...(client.configured ? { arrivals: adapter.arrivals } : {}) };
    } });
  }
  return extensions;
}
