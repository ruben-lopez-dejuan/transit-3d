import { timingSafeEqual } from 'node:crypto';

import type {
  AdminCatalogDiagnostics,
  AdminCityDiagnostics,
  AdminCityIndex,
  AdminFinding,
  AdminProviderDiagnostics,
} from '../../shared/transit/admin';
import type { PositionQuality, PositionSource, TransitMode } from '../../shared/transit/contracts';
import type { Network, Snapshot, Vehicle } from '../../shared/transit/network';
import type { RuntimeCityPackage } from '../transit/cityPackage';

const POSITION_SOURCES: PositionSource[] = [
  'GPS',
  'PROVIDER_ESTIMATED',
  'INTERPOLATED_REALTIME',
  'SCHEDULE_SIMULATION',
  'STALE',
];
const POSITION_QUALITIES: PositionQuality[] = ['live', 'predicted', 'scheduled'];

export function isAdminAuthorized(configuredToken: string | undefined, suppliedToken: string | undefined) {
  if (!configuredToken) return true;
  if (!suppliedToken) return false;
  const configured = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);
  return configured.length === supplied.length && timingSafeEqual(configured, supplied);
}

export function sanitizedAdminError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/([?&](?:api[_-]?key|token|passkey|password|secret)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|passkey|password|secret)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .slice(0, 500);
}

export function cityIndex(city: RuntimeCityPackage, initialized: boolean): AdminCityIndex {
  const checked = city.providers.filter((provider) => provider.health.checkedTimestamp > 0);
  return {
    id: city.manifest.id,
    name: city.manifest.name,
    region: city.manifest.region,
    initialized,
    providers: city.providers.length,
    checkedProviders: checked.length,
    problemProviders: checked.filter((provider) => provider.health.state !== 'healthy').length,
  };
}

function counts<T extends string>(values: readonly T[], selected: T[]): Record<T, number> {
  return Object.fromEntries(selected.map((value) => [value, values.filter((item) => item === value).length])) as Record<T, number>;
}

function providerFindings(
  provider: RuntimeCityPackage['providers'][number],
  catalog: AdminCatalogDiagnostics,
  vehicles: Vehicle[],
  realtimeTripCount: number,
  healthError?: string,
): AdminFinding[] {
  const findings: AdminFinding[] = [];
  const gps = vehicles.filter((vehicle) => vehicle.positionSource === 'GPS').length;
  const stale = vehicles.filter((vehicle) => vehicle.positionSource === 'STALE').length;
  const scheduled = vehicles.filter((vehicle) => vehicle.positionSource === 'SCHEDULE_SIMULATION').length;

  if (!provider.enabled) findings.push({ severity: 'info', code: 'provider_disabled', message: 'El proveedor está desactivado por configuración.' });
  if (catalog.state === 'loading') findings.push({ severity: 'info', code: 'catalog_loading', message: 'El catálogo GTFS todavía se está cargando.' });
  if (catalog.state === 'error') findings.push({ severity: 'error', code: 'catalog_error', message: `El catálogo GTFS no está disponible: ${sanitizedAdminError(catalog.error ?? 'error desconocido')}` });
  if (healthError) findings.push({ severity: provider.health.state === 'unavailable' ? 'error' : 'warning', code: 'provider_error', message: sanitizedAdminError(healthError) });
  if (provider.enabled && catalog.state === 'ready' && vehicles.length === 0) findings.push({ severity: 'info', code: 'no_active_vehicles', message: 'No hay vehículos activos en la instantánea actual.' });
  if (provider.definition.capabilities.vehiclePositions && catalog.state === 'ready' && vehicles.length > 0 && gps === 0) findings.push({ severity: 'warning', code: 'gps_missing', message: 'El proveedor declara posiciones de vehículos, pero la instantánea no contiene ninguna posición GPS.' });
  if (provider.definition.capabilities.tripUpdates && catalog.state === 'ready' && realtimeTripCount === 0) findings.push({ severity: 'warning', code: 'trip_updates_missing', message: 'El proveedor declara actualizaciones de viajes, pero no se han unido actualizaciones realtime.' });
  if (stale > 0) findings.push({ severity: 'warning', code: 'stale_positions', message: `${stale} vehículo${stale === 1 ? '' : 's'} conserva${stale === 1 ? '' : 'n'} datos caducados.` });
  if (provider.health.state === 'stale' && scheduled > 0 && stale === 0) findings.push({ severity: 'warning', code: 'realtime_schedule_fallback', message: `La señal realtime está caducada. Los ${scheduled} vehículos visibles proceden del horario y no son posiciones antiguas reutilizadas.` });
  if (vehicles.length > 0 && scheduled === vehicles.length) findings.push({ severity: 'info', code: 'schedule_only', message: 'Todas las posiciones visibles proceden del horario estático.' });
  return findings;
}

export function buildCityDiagnostics(
  city: RuntimeCityPackage,
  network: Network,
  snapshot: Snapshot,
  catalogs: AdminCatalogDiagnostics[],
  generatedAt = Date.now(),
): AdminCityDiagnostics {
  const providers: AdminProviderDiagnostics[] = city.providers.map((provider) => {
    const definition = provider.definition;
    const catalog = catalogs.find((item) => item.providerId === provider.operatorId) ?? {
      providerId: provider.operatorId,
      state: provider.enabled ? 'loading' : 'disabled',
      routes: 0,
      trips: 0,
      stops: 0,
      shapes: 0,
      services: 0,
    } satisfies AdminCatalogDiagnostics;
    const operator = network.operators.find((item) => item.id === provider.operatorId);
    const status = snapshot.providers.find((item) => item.providerId === provider.operatorId);
    const vehicles = snapshot.vehicles.filter((vehicle) => vehicle.providerId === provider.operatorId);
    const health = status?.health ?? provider.health;
    const byMode: Partial<Record<TransitMode, number>> = {};
    for (const vehicle of vehicles) byMode[vehicle.mode] = (byMode[vehicle.mode] ?? 0) + 1;
    const findings = providerFindings(provider, catalog, vehicles, status?.realtimeTripCount ?? 0, status?.error ?? health.error);
    return {
      id: provider.operatorId,
      name: definition.name,
      color: definition.color,
      group: definition.group,
      primary: definition.primary,
      enabled: provider.enabled,
      loading: operator?.loading ?? catalog.state === 'loading',
      status: health.checkedTimestamp <= 0 ? 'not_checked' : health.state === 'healthy' ? 'ok' : health.state,
      capabilities: definition.capabilities,
      catalog,
      vehicles: {
        total: vehicles.length,
        byPositionSource: counts(vehicles.map((vehicle) => vehicle.positionSource), POSITION_SOURCES),
        byQuality: counts(vehicles.map((vehicle) => vehicle.positionQuality), POSITION_QUALITIES),
        byMode,
      },
      realtimeTripCount: status?.realtimeTripCount ?? 0,
      realtimeArrivalCount: status?.realtimeArrivalCount ?? 0,
      timestamps: {
        fetched: snapshot.fetchedAt || null,
        source: status?.sourceTimestamp ?? health.sourceTimestamp,
        received: status?.receivedTimestamp ?? health.receivedTimestamp,
        checked: health.checkedTimestamp || null,
        lastSuccess: health.lastSuccessTimestamp,
      },
      health,
      ...(status?.error ?? health.error ? { error: sanitizedAdminError(status?.error ?? health.error) } : {}),
      findings,
      samples: vehicles.slice(0, 8).map((vehicle) => ({
        id: vehicle.id,
        route: vehicle.routeShortName || vehicle.label,
        destination: vehicle.destination,
        mode: vehicle.mode,
        positionSource: vehicle.positionSource,
        positionQuality: vehicle.positionQuality,
        sourceTimestamp: vehicle.sourceTimestamp,
        receivedTimestamp: vehicle.receivedTimestamp,
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
      })),
    };
  });
  const memory = process.memoryUsage();
  return {
    generatedAt,
    city: city.manifest,
    providers,
    totals: {
      providers: providers.length,
      readyCatalogs: providers.filter((provider) => provider.catalog.state === 'ready').length,
      vehicles: providers.reduce((total, provider) => total + provider.vehicles.total, 0),
      gps: providers.reduce((total, provider) => total + provider.vehicles.byPositionSource.GPS, 0),
      providerEstimated: providers.reduce((total, provider) => total + provider.vehicles.byPositionSource.PROVIDER_ESTIMATED + provider.vehicles.byPositionSource.INTERPOLATED_REALTIME, 0),
      scheduled: providers.reduce((total, provider) => total + provider.vehicles.byPositionSource.SCHEDULE_SIMULATION, 0),
      stale: providers.reduce((total, provider) => total + provider.vehicles.byPositionSource.STALE, 0),
      issues: providers.reduce((total, provider) => total + provider.findings.filter((finding) => finding.severity !== 'info').length, 0),
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      rssBytes: memory.rss,
    },
  };
}
