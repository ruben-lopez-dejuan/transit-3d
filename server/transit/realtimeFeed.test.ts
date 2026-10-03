import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import bindings from 'gtfs-realtime-bindings';
import { RealtimeFeedClient, decodeRealtimeFeed } from '../providers/realtimeFeed';
import { decodeBizkaibusRealtime } from '../providers/bizkaibus/realtime';
import { RealtimeProvider } from '../providers/realtimeProvider';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';

const encode = (timestamp: number, incrementality = 0) => Buffer.from(bindings.transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: timestamp / 1000, incrementality },
  entity: [{ id: 'bus', vehicle: { trip: { tripId: 't' }, vehicle: { id: '123' }, position: { latitude: 43.26, longitude: -2.94 }, timestamp: timestamp / 1000, currentStatus: 1 } }],
}).finish());
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('restarting a provider immediately restores fresh cache while exactly one download is pending', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-rt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Math.floor(Date.now() / 1000) * 1000, source = now - 149_000;
  fs.writeFileSync(path.join(directory, 'fixture.pb'), encode(source));
  let calls = 0, finish!: () => void;
  const download = async (_url: string, file: string) => {
    calls++; await new Promise<void>((resolve) => { finish = resolve; });
    fs.writeFileSync(file, encode(source)); return fs.statSync(file).size;
  };
  const client = new RealtimeFeedClient('fixture', 'unused:no-network', { cacheDirectory: directory, download });
  const first = await client.get(now);
  assert.ok(first.feed); assert.equal(first.sourceTimestamp, source);
  assert.equal(first.receivedTimestamp, null, 'disk cache cannot invent an HTTP receipt');
  assert.deepEqual(await client.get(now + 5000), first); assert.equal(calls, 1);
  finish(); await flush();
  const received = await client.get(now + 10_000);
  assert.ok(received.receivedTimestamp); assert.equal(received.sourceTimestamp, source);
  assert.equal((await client.get(source + 181_000)).feed, null, 'successful HTTP cannot renew old source time');
});

test('expired, future, differential and corrupt caches cannot become live after restart', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-rt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Math.floor(Date.now() / 1000) * 1000;
  for (const [name, bytes] of [['expired', encode(now - 181_000)], ['future', encode(now + 61_000)], ['differential', encode(now, 1)], ['corrupt', Buffer.from('not protobuf')]] as const) {
    fs.writeFileSync(path.join(directory, `${name}.pb`), bytes);
    const client = new RealtimeFeedClient(name, 'unused:no-network', { cacheDirectory: directory, download: async () => { throw new Error('offline'); } });
    const state = await client.get(now); assert.equal(state.feed, null); assert.equal(state.receivedTimestamp, null);
    await flush(); assert.equal((await client.get(now)).feed, null);
  }
});

test('an invalid refresh preserves the last validated cache and never advances its timestamps', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-rt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Math.floor(Date.now() / 1000) * 1000, bytes = encode(now - 30_000), file = path.join(directory, 'fixture.pb');
  fs.writeFileSync(file, bytes);
  const client = new RealtimeFeedClient('fixture', 'unused:no-network', { cacheDirectory: directory, download: async (_url, target) => { fs.writeFileSync(target, 'invalid'); return 7; } });
  await client.get(now); await flush();
  const state = await client.get(now);
  assert.ok(state.feed); assert.ok(state.error);
  assert.equal(state.sourceTimestamp, now - 30_000); assert.equal(state.receivedTimestamp, null);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('Bizkaibus cache decoding retains sparse observation time, physical identity and stop state', () => {
  const source = Math.floor(Date.now() / 1000) * 1000 - 149_000;
  const cached = decodeBizkaibusRealtime(encode(source), null, 0);
  assert.equal(cached.receivedTimestamp, null); assert.equal(cached.fetchedAtMs, 0);
  assert.equal(cached.feedTimestamp, source / 1000);
  assert.equal(cached.vehicles[0].timestamp, source / 1000);
  assert.equal(cached.vehicles[0].vehicleId, '123'); assert.equal(cached.vehicles[0].currentStatus, 1);
  assert.throws(() => decodeBizkaibusRealtime(encode(source, 1), null, 0), /Unsupported/);
  assert.throws(() => decodeRealtimeFeed(encode(source, 1)), /Unsupported/);
});

test('a fresh header with old entities reports fallback without presenting those positions as live', async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const client = new RealtimeFeedClient('fixture', 'unused:no-network');
  const feed = decodeRealtimeFeed(encode(now - 240_000)); feed.header!.timestamp = now / 1000;
  Object.assign(client, { feed, cacheLoaded: true, receivedTimestamp: now, expires: now + 15_000 });
  const gtfs: BizkaibusGtfs = { routes: new Map(), trips: new Map(), stops: new Map(), shapes: new Map(), tripStops: new Map(), routeTripIds: new Map(), calendars: new Map(), calendarDates: new Map() };
  const provider = new RealtimeProvider({ operatorId: 'dbus', getSnapshot: async () => ({ operatorId: 'dbus', fetchedAt: now, sourceTimestamp: null, status: 'ok', vehicles: [] }) }, async () => gtfs, undefined, client);
  const snapshot = await provider.getSnapshot(new Date(now));
  assert.equal(snapshot.status, 'degraded'); assert.equal(snapshot.vehicles.length, 0);
  assert.match(snapshot.error!, /no contiene observaciones vigentes compatibles/);
});
