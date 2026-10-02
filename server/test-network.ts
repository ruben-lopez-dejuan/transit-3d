import assert from 'node:assert/strict';
import type { Network, Snapshot, LineDetail, StopDetail, TripDetail, Shape } from '../src/transit/networkTypes';

const base = process.env.TRANSIT_TEST_URL ?? 'http://localhost:3001';
async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(120000), ...init });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json() as Promise<T>;
}
const network = await get<Network>('/api/network');
const snapshot = await get<Snapshot>('/api/transit');
assert.equal(new Set(snapshot.vehicles.map((v) => v.id)).size, snapshot.vehicles.length, 'Vehicle identities must be unique');
for (const v of snapshot.vehicles) {
  assert.ok(Number.isFinite(v.progressMetersAlongShape) && Number.isFinite(v.longitude) && Number.isFinite(v.latitude));
  assert.ok(['live', 'predicted', 'scheduled'].includes(v.positionQuality));
  assert.ok(network.routes.some((r) => r.key === v.routeKey));
  if (v.positionQuality === 'scheduled') assert.equal(v.observationTimestamp, null);
}
console.table(network.operators.map((o) => ({ operator: o.name, status: snapshot.providers.find((p) => p.operatorId === o.id)?.status, routes: network.routes.filter((r) => r.operatorId === o.id).length, stops: network.stops.filter((s) => s.operatorId === o.id).length, vehicles: snapshot.vehicles.filter((v) => v.operatorId === o.id).length })));
for (const operator of network.operators) {
  const route = network.routes.find((r) => r.operatorId === operator.id);
  if (!route) { console.warn(`${operator.name}: no catalog available; inspect provider status.`); continue; }
  const line = await get<LineDetail>(`/api/lines/${operator.id}/${encodeURIComponent(route.routeId)}`);
  assert.equal(line.route.key, route.key);
  const stop = line.stops[0];
  if (stop) { const detail = await get<StopDetail>(`/api/stops/${operator.id}/${encodeURIComponent(stop.stopId)}`); assert.equal(detail.stop.key, stop.key); assert.ok(detail.departures.every((d, i, a) => i === 0 || d.at >= a[i - 1].at)); }
  const vehicle = snapshot.vehicles.find((v) => v.operatorId === operator.id);
  if (vehicle) {
    const trip = await get<TripDetail>(`/api/trips/${operator.id}/${encodeURIComponent(vehicle.tripId)}?date=${vehicle.serviceDate}&vehicleId=${encodeURIComponent(vehicle.id)}`);
    assert.equal(trip.vehicleId, vehicle.id);
    const shapes = await get<Shape[]>('/api/geometries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [vehicle.shapeKey] }) });
    assert.equal(shapes[0]?.key, vehicle.shapeKey);
    assert.equal(shapes[0].coordinates.length, shapes[0].cumulative.length);
  }
}
const invalid = await fetch(`${base}/api/geometries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [123] }) });
assert.equal(invalid.status, 400);
console.log('Network API smoke passed. Provider unavailability is reported separately from unit tests.');
