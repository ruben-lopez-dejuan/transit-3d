import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdapterVehicle, NormalizedVehicle } from '../../shared/transit/contracts';
import { TransitDebugTraceStore } from './traceStore';

const at = Date.parse('2026-10-14T10:00:00Z');
const adapter: AdapterVehicle = {
  id: 'vehicle', operatorId: 'provider', mode: 'bus', tripId: 'trip', routeId: 'route',
  directionId: 0, shapeId: 'shape', progressMetersAlongShape: 120, latitude: 43.2,
  longitude: -2.9, bearing: 90, positionQuality: 'live', observationTimestamp: at - 10_000,
  predictionTimestamp: at, receivedTimestamp: at - 1_000, delaySeconds: null,
};
const normalized: NormalizedVehicle = {
  ...adapter, id: 'city:provider:vehicle:vehicle', cityId: 'city', providerId: 'provider',
  routeId: 'city:provider:route:route', tripId: 'city:provider:trip:trip',
  shapeId: 'city:provider:shape:shape', externalRouteId: 'route', externalTripId: 'trip',
  externalShapeId: 'shape', serviceDate: '20261014', routeShortName: '1', destination: 'Centro',
  lat: adapter.latitude, lon: adapter.longitude, speed: null, sourceTimestamp: at - 10_000,
  receivedTimestamp: at - 1_000, status: 'IN_SERVICE', positionSource: 'GPS',
};

test('debug traces preserve provider, source and receipt timestamps without refreshing duplicates', () => {
  const store = new TransitDebugTraceStore();
  store.enable('city', at);
  store.recordAdapter('city', at, adapter, normalized, at);
  store.recordAdapter('city', at + 5_000, adapter, normalized, at + 5_000);
  const trace = store.get('city', normalized.id, null, at + 5_000);
  assert.equal(trace.history.length, 1);
  assert.equal(trace.adapter?.observationTimestamp, at - 10_000);
  assert.equal(trace.normalized?.receivedTimestamp, at - 1_000);
  assert.equal(trace.history[0].adapterFetchedAt, at);
});

test('debug traces add changed observations and ignore schedule-only fleets', () => {
  const store = new TransitDebugTraceStore();
  store.enable('city', at);
  store.recordAdapter('city', at, adapter, normalized, at);
  store.recordAdapter('city', at + 10_000, { ...adapter, progressMetersAlongShape: 180, observationTimestamp: at }, { ...normalized, progressMetersAlongShape: 180, sourceTimestamp: at }, at + 10_000);
  assert.equal(store.get('city', normalized.id, null, at + 10_000).history.length, 2);
  const scheduled = { ...normalized, id: 'scheduled', sourceTimestamp: null, observationTimestamp: null, positionSource: 'SCHEDULE_SIMULATION' as const, positionQuality: 'scheduled' as const };
  store.recordAdapter('city', at, { ...adapter, observationTimestamp: null, positionQuality: 'scheduled' }, scheduled, at);
  assert.equal(store.get('city', 'scheduled', null, at).history.length, 0);
});
