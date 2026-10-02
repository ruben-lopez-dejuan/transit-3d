import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCityPackage } from './packageConfig';
import { createFolderCity, loadFolderCities } from './folderPackage';
import { ProviderRegistry } from '../transit/registry';
import type { RuntimeCityPackage } from '../transit/cityPackage';

// Explicitly synthetic configuration. Tests never fetch these reserved example URLs.
const fixture = () => ({ apiVersion: 1, id: 'es-test', countryCode: 'ES', name: 'Test', region: 'Test', timezone: 'Europe/Madrid',
  center: [-3, 43], bounds: [[-4, 42], [-2, 44]], modes: ['bus'],
  presentation: { title: 'Transit', mapLabel: 'Mapa', searchLabel: 'Buscar', initialZoom: 12, brandMark: 't.' },
  providers: [{ id: 'bus', name: 'Bus', color: '#ff0000', sources: { gtfs: 'https://example.org/gtfs.zip' } }],
});
test('data-only format accepts static sources and returns an independent configuration', () => {
  const raw = fixture(), parsed = parseCityPackage(raw);
  raw.providers[0].name = 'Changed';
  assert.equal(parsed.providers[0].name, 'Bus');
  assert.equal(parsed.apiVersion, 1);
});
test('rejects incompatible versions, invalid IDs, timezone, coordinates and unsupported fields', () => {
  for (const patch of [{ apiVersion: 2 }, { id: '../test' }, { countryCode: 'FR' }, { timezone: 'Invalid/Zone' }, { bounds: [[-2, 44], [-4, 42]] }, { center: [NaN, 43] }, { center: [10, 10] }, { modes: ['plane'] }, { modes: ['bus', 'bus'] }, { code: 'execute()' }]) {
    assert.throws(() => parseCityPackage({ ...fixture(), ...patch }));
  }
});
test('rejects credentials, non-HTTPS sources, unsupported protocols and duplicate providers', () => {
  for (const gtfs of ['http://example.org/a', 'https://user:secret@example.org/a', 'file:///a', 'not-url', 'https://example.org/a#fragment']) {
    const raw = fixture(); raw.providers[0].sources.gtfs = gtfs; assert.throws(() => parseCityPackage(raw));
  }
  const raw = fixture(); raw.providers.push(raw.providers[0]); assert.throws(() => parseCityPackage(raw));
  assert.throws(() => parseCityPackage({ ...fixture(), providers: [] }));
});
test('validates route filters, speed and appearance instead of silently ignoring bad settings', () => {
  const base = fixture();
  const provider = { ...base.providers[0], routeIds: ['C1'], maximumGpsSpeed: 30, appearance: { kind: 'bus', composition: { count: 1, length: 12, gap: 0 }, lateralOffsetMeters: 0 } };
  assert.equal(parseCityPackage({ ...base, providers: [provider] }).providers[0].routeIds?.[0], 'C1');
  for (const patch of [{ routeIds: [] }, { routeIds: ['C1', 'C1'] }, { maximumGpsSpeed: Infinity }, { appearance: { ...provider.appearance, composition: { count: 1.5, length: 12, gap: 0 } } }, { sources: { gtfs: 'https://example.org/a', siri: 'https://example.org/siri' } }]) assert.throws(() => parseCityPackage({ ...base, providers: [{ ...provider, ...patch }] }));
});
test('generic adapters derive only supported capabilities and preserve appearance metadata', async () => {
  const base = fixture();
  const city = createFolderCity(parseCityPackage(base));
  assert.equal(city.manifest.providers[0].realtime, false);
  assert.deepEqual(city.manifest.providers[0].capabilities, { staticGtfs: true, vehiclePositions: false, tripUpdates: false, serviceAlerts: false, occupancy: false, speed: false, bearing: false, stopArrivals: false });
  assert.equal(city.providers[0].appearanceFor?.({ mode: 'rail', routeId: '1' }, '1').kind, 'train');
  assert.equal(city.providers[0].health.cityId, 'es-test');
  city.providers[0].enabled = false;
  assert.equal((await city.providers[0].getSnapshot()).health.state, 'unavailable');
  const live = createFolderCity(parseCityPackage({ ...base, providers: [{ ...base.providers[0], sources: { ...base.providers[0].sources, tripUpdates: 'https://example.org/tu.pb', vehiclePositions: 'https://example.org/vp.pb' } }] }));
  assert.equal(live.manifest.providers[0].capabilities.tripUpdates, true);
  assert.equal(live.manifest.providers[0].capabilities.vehiclePositions, true);
  assert.equal(live.providers[0].health.sourceTimestamp, null);
});
test('folder discovery isolates malformed, mismatched and duplicate packages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-city-test-'));
  try {
    const write = (directory: string, content: string) => { fs.mkdirSync(path.join(root, directory)); fs.writeFileSync(path.join(root, directory, 'city.json'), content); };
    write('es-test', JSON.stringify(fixture()));
    write('es-broken', '{');
    write('es-mismatch', JSON.stringify(fixture()));
    const registry = new ProviderRegistry<RuntimeCityPackage>();
    const reports = loadFolderCities(registry, root);
    assert.equal(reports.filter((row) => row.state === 'loaded').length, 1);
    assert.equal(reports.filter((row) => row.state === 'invalid').length, 2);
    assert.equal(registry.getCities().length, 1);
    const again = loadFolderCities(registry, root);
    assert.match(again.find((row) => row.directory === 'es-test')!.error!, /already registered/);
    assert.equal(registry.getCities().length, 1);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'transit-city-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('missing package root leaves the registry untouched', () => {
  const registry = new ProviderRegistry<RuntimeCityPackage>();
  assert.deepEqual(loadFolderCities(registry, path.join(os.tmpdir(), 'transit-missing-' + crypto.randomUUID())), []);
  assert.equal(registry.getCities().length, 0);
});
