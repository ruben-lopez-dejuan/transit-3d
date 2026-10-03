import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { createCityNetwork } from '../transit/network';
import { parseCityPackage } from './packageConfig';
import { createFolderCity, loadFolderCities } from './folderPackage';
import { ProviderRegistry } from '../transit/registry';
import type { RuntimeCityPackage } from '../transit/cityPackage';
import { sourceIdentity } from '../sources/types';
import { CityExtensionRegistry } from './extensionRegistry';

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
test('the template shared with normal chats conforms to the runtime contract', () => {
  const file = new URL('../../docs/city-package-kit/city.example.json', import.meta.url);
  assert.equal(parseCityPackage(JSON.parse(fs.readFileSync(file, 'utf8'))).id, 'es-example');
  const schema = JSON.parse(fs.readFileSync(new URL('../../docs/city-package-kit/city.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.apiVersion.enum, [1, 2]);
  assert.equal(schema.additionalProperties, false);
});
test('rejects incompatible versions, invalid IDs, timezone, coordinates and unsupported fields', () => {
  for (const patch of [{ apiVersion: 3 }, { id: '../test' }, { countryCode: 'FR' }, { timezone: 'Invalid/Zone' }, { bounds: [[-2, 44], [-4, 42]] }, { center: [NaN, 43] }, { center: [10, 10] }, { modes: ['plane'] }, { modes: ['bus', 'bus'] }, { code: 'execute()' }]) {
    assert.throws(() => parseCityPackage({ ...fixture(), ...patch }));
  }
});
test('API 2 accepts explicit HTTP and stable NAP descriptors while API 1 remains unchanged', () => {
  const base = fixture();
  const v2 = { ...base, apiVersion: 2, providers: [{ ...base.providers[0], sources: { gtfs: { type: 'nap', datasetId: 896, fileId: 1097 }, tripUpdates: { type: 'http', url: 'https://example.org/trips.pb' } } }] };
  const parsed = parseCityPackage(v2);
  assert.equal(parsed.apiVersion, 2); assert.equal((parsed.providers[0].sources.gtfs as { fileId: number }).fileId, 1097);
  assert.equal(sourceIdentity(parsed.providers[0].sources.gtfs as import('../sources/types').SourceDescriptor), 'nap:896:1097');
  for (const invalid of [{ type: 'nap', datasetId: 0, fileId: 1 }, { type: 'nap', datasetId: 1, fileId: 1, apiKey: 'secret' }, { type: 'http', url: 'https://user:secret@example.org/a' }, 'https://example.org/legacy']) {
    assert.throws(() => parseCityPackage({ ...v2, providers: [{ ...v2.providers[0], sources: { gtfs: invalid } }] }));
  }
});
test('trusted city extensions are selected by a registry outside the generic loader', () => {
  const registry = new CityExtensionRegistry(); registry.register('es-test', () => new Map());
  assert.equal(registry.get(parseCityPackage(fixture())).size, 0);
  assert.equal(registry.get(parseCityPackage({ ...fixture(), id: 'es-other' })).size, 0);
  assert.throws(() => registry.register('es-test', () => new Map()), /already registered/);
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
test('a copied GTFS package produces catalog, geometry and scheduled vehicles without touching Bilbao', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-city-test-')), previous = process.cwd();
  try {
    process.chdir(root);
    const config = parseCityPackage({ ...fixture(), providers: [{ ...fixture().providers[0], routeIds: ['r1'] }] });
    const seed = (cityId: string) => {
      const settings = config.providers[0];
      const sources = Object.fromEntries(Object.entries(settings.sources).map(([key, value]) => [key, sourceIdentity(typeof value === 'string' ? { type: 'http', url: value } : value)]));
      const hash = createHash('sha256').update(JSON.stringify({ ...settings, sources })).digest('hex');
      const directory = path.resolve('server/cache', `${cityId}-${hash}`, 'bus');
      fs.mkdirSync(directory, { recursive: true });
      const zip = new AdmZip();
      const tables = {
        routes: 'route_id,route_short_name,route_long_name,route_type\nr1,1,Test,3\nr2,2,Outside,3\n',
        trips: 'route_id,service_id,trip_id,shape_id\nr1,daily,t1,s1\nr2,daily,t2,s2\n',
        stops: 'stop_id,stop_name,stop_lat,stop_lon\na,Start,43,-3\nb,End,43,-2.99\nx,Outside,0,0\n',
        stop_times: 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt1,a,1,00:00:00,00:00:00\nt1,b,2,24:00:00,24:00:00\nt2,x,1,00:00:00,00:00:00\n',
        shapes: 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,43,-3,1\ns1,43,-2.99,2\ns2,0,0,1\ns2,0,1,2\n',
        calendar: 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ndaily,1,1,1,1,1,1,1,20260101,20300101\n',
      };
      for (const [table, text] of Object.entries(tables)) zip.addFile(table + '.txt', Buffer.from(text));
      zip.writeZip(path.join(directory, 'gtfs.zip'));
      return createFolderCity({ ...config, id: cityId });
    };
    const city = seed('es-test'), other = seed('es-other');
    const gtfs = await city.providers[0].getGtfs();
    assert.deepEqual([...gtfs.routes.keys()], ['r1']);
    assert.deepEqual([...gtfs.shapes.keys()], ['s1']);
    assert.deepEqual([...gtfs.stops.keys()], ['a', 'b']);
    const network = createCityNetwork(city), otherNetwork = createCityNetwork(other);
    const [catalog, second] = await Promise.all([network.getNetwork(), otherNetwork.getNetwork()]);
    assert.equal(catalog.routes[0].id, 'es-test:bus:route:r1');
    assert.equal(second.routes[0].id, 'es-other:bus:route:r1');
    assert.equal(catalog.stops.length, 2);
    const snapshot = await city.providers[0].getSnapshot(new Date('2026-10-03T10:00:00Z'));
    assert.equal(snapshot.vehicles.length, 1);
    assert.equal(snapshot.vehicles[0].positionSource, 'SCHEDULE_SIMULATION');
    assert.equal(snapshot.vehicles[0].sourceTimestamp, null);
    assert.ok(snapshot.vehicles[0].receivedTimestamp! > 0);
    const shape = await network.getGeometries([snapshot.vehicles[0].shapeId]);
    assert.equal(shape.length, 1);
    assert.equal((await network.getGeometries(['es-other:bus:shape:s1'])).length, 0);
  } finally {
    process.chdir(previous);
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'transit-city-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
