import assert from 'node:assert/strict';
import test from 'node:test';

import type { CityManifest, NormalizedProviderSnapshot, ProviderDefinition, ProviderHealth } from '../../shared/transit/contracts';
import type { Network, Snapshot, Vehicle } from '../../shared/transit/network';
import type { AdminCatalogDiagnostics } from '../../shared/transit/admin';
import type { ProviderRuntime, RuntimeCityPackage } from '../transit/cityPackage';
import { buildCityDiagnostics, cityIndex, isAdminAuthorized, sanitizedAdminError } from './diagnostics';

const at = Date.parse('2026-10-09T12:00:00Z');
const capabilities = { staticGtfs: true, vehiclePositions: true, tripUpdates: true, serviceAlerts: false, occupancy: false, speed: true, bearing: true, stopArrivals: false };
const definition = (id: string): ProviderDefinition => ({ id, name: id, color: '#246b57', realtime: true, capabilities });
const manifest: CityManifest = {
  id: 'test-city', countryCode: 'ES', name: 'Test City', region: 'Test', timezone: 'Europe/Madrid',
  center: [0, 0], bounds: [[-1, -1], [1, 1]], providers: [definition('live'), definition('fallback')], modes: ['bus'], apiVersion: 1,
  presentation: { title: 'Test', mapLabel: 'Test', searchLabel: 'Test', initialZoom: 12, brandMark: 't' },
};
const health = (providerId: string, state: ProviderHealth['state'] = 'healthy'): ProviderHealth => ({ cityId: manifest.id, providerId, state, checkedTimestamp: at, sourceTimestamp: at - 20_000, receivedTimestamp: at - 2_000, lastSuccessTimestamp: at });
const provider = (id: string, state: ProviderHealth['state'] = 'healthy') => ({ cityId: manifest.id, operatorId: id, definition: manifest.providers.find((item) => item.id === id)!, enabled: true, health: health(id, state) }) as unknown as ProviderRuntime;
const city: RuntimeCityPackage = { manifest, providers: [provider('live'), provider('fallback', 'degraded')], places: () => [], infrastructure: () => [] };
const vehicle = (id: string, source: Vehicle['positionSource']): Vehicle => ({
  id, providerId: id.startsWith('fallback') ? 'fallback' : 'live', operatorId: id.startsWith('fallback') ? 'fallback' : 'live', cityId: manifest.id,
  mode: 'bus', routeShortName: '1', label: '1', destination: 'Centro', headsign: 'Centro', latitude: 40, longitude: -3,
  positionSource: source, positionQuality: source === 'GPS' ? 'live' : source === 'SCHEDULE_SIMULATION' ? 'scheduled' : 'predicted',
  sourceTimestamp: at - 20_000, receivedTimestamp: at - 2_000,
}) as unknown as Vehicle;
const network: Network = {
  city: manifest, routes: [], stops: [], places: [],
  operators: manifest.providers.map((item) => ({ ...item, status: item.id === 'live' ? 'ok' : 'degraded' })),
};
const providerSnapshot = (id: string, state: ProviderHealth['state'], trips: number, error?: string): Snapshot['providers'][number] => ({
  cityId: manifest.id, providerId: id, operatorId: id, fetchedAt: at, sourceTimestamp: at - 20_000, receivedTimestamp: at - 2_000,
  status: state === 'healthy' ? 'ok' : 'degraded', realtimeTripCount: trips, realtimeArrivalCount: 2, capabilities,
  health: { ...health(id, state), ...(error ? { error } : {}) }, ...(error ? { error } : {}),
}) as Omit<NormalizedProviderSnapshot, 'vehicles'>;
const snapshot: Snapshot = {
  cityId: manifest.id, fetchedAt: at,
  vehicles: [vehicle('gps-1', 'GPS'), vehicle('estimate-1', 'PROVIDER_ESTIMATED'), vehicle('fallback-1', 'SCHEDULE_SIMULATION'), vehicle('fallback-2', 'STALE')],
  providers: [providerSnapshot('live', 'healthy', 3), providerSnapshot('fallback', 'degraded', 0, 'feed failed?apiKey=secret-value')],
};
const catalogs: AdminCatalogDiagnostics[] = [
  { providerId: 'live', state: 'ready', routes: 4, trips: 20, stops: 30, shapes: 5, services: 2 },
  { providerId: 'fallback', state: 'ready', routes: 2, trips: 10, stops: 12, shapes: 2, services: 1 },
];

test('admin token comparison permits local open mode and rejects absent or incorrect configured tokens', () => {
  assert.equal(isAdminAuthorized(undefined, undefined), true);
  assert.equal(isAdminAuthorized('', undefined), true);
  assert.equal(isAdminAuthorized('correct', undefined), false);
  assert.equal(isAdminAuthorized('correct', 'wrong'), false);
  assert.equal(isAdminAuthorized('correct', 'correct'), true);
});

test('city index is lightweight and reports existing health without loading feeds', () => {
  const result = cityIndex(city, false);
  assert.deepEqual(result, { id: 'test-city', name: 'Test City', region: 'Test', initialized: false, providers: 2, checkedProviders: 2, problemProviders: 1 });
});

test('diagnostics preserve source semantics, timestamps, catalog counts and actionable findings', () => {
  const result = buildCityDiagnostics(city, network, snapshot, catalogs, at + 1000);
  assert.equal(result.totals.vehicles, 4);
  assert.equal(result.totals.gps, 1);
  assert.equal(result.totals.providerEstimated, 1);
  assert.equal(result.totals.scheduled, 1);
  assert.equal(result.totals.stale, 1);
  assert.equal(result.providers[0].catalog.trips, 20);
  assert.equal(result.providers[0].timestamps.source, at - 20_000);
  assert.equal(result.providers[0].timestamps.received, at - 2_000);
  const fallback = result.providers[1];
  assert.equal(fallback.error?.includes('secret-value'), false);
  assert.ok(fallback.findings.some((finding) => finding.code === 'provider_error'));
  assert.ok(fallback.findings.some((finding) => finding.code === 'gps_missing'));
  assert.ok(fallback.findings.some((finding) => finding.code === 'trip_updates_missing'));
  assert.ok(fallback.findings.some((finding) => finding.code === 'stale_positions'));
});

test('errors redact credentials from URLs and key-value fragments', () => {
  const result = sanitizedAdminError('https://example.test/feed?ApiKey=abc123&token=def456 Authorization token: xyz');
  assert.equal(result.includes('abc123'), false);
  assert.equal(result.includes('def456'), false);
  assert.equal(result.includes('xyz'), false);
  assert.match(result, /\[redacted\]/);
});
