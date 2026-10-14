import assert from 'node:assert/strict';
import test from 'node:test';
import { bilbobusPositionTimestamp, bilbobusProgress, ed50ToWgs84, keepRecentlyPlaced, parseSiriArrivals } from '../providers/bilbobus';
import type { TransitVehicle } from './types';
import { buildShapeMetric, projectOntoShape } from './motionEngine';
import { ObservationTracker } from './observations';
test('ED50 UTM30 coordinates convert into Bilbao WGS84, including the datum shift', () => {
  const result = ed50ToWgs84(503631, 4790217)!;
  assert.ok(Math.abs(result[0] + 2.9565231) < .00001);
  assert.ok(Math.abs(result[1] - 43.2628654) < .00001);
  assert.equal(ed50ToWgs84(0, 0), null);
});
test('Bilbobus Instante uses Madrid wall time despite its Z suffix, including winter', () => {
  assert.equal(bilbobusPositionTimestamp('2026-10-02T15:51:10.000Z'), Date.parse('2026-10-02T13:51:10Z'));
  assert.equal(bilbobusPositionTimestamp('2026-12-02T15:51:10.000Z'), Date.parse('2026-12-02T14:51:10Z'));
});

test('municipal wall-clock timestamps resolve repeated DST hours and reject nonexistent times', () => {
  assert.equal(bilbobusPositionTimestamp('2026-10-25T02:15:00Z', Date.parse('2026-10-25T00:20:00Z')), Date.parse('2026-10-25T00:15:00Z'));
  assert.equal(bilbobusPositionTimestamp('2026-10-25T02:15:00Z', Date.parse('2026-10-25T01:20:00Z')), Date.parse('2026-10-25T01:15:00Z'));
  assert.equal(bilbobusPositionTimestamp('2026-03-29T02:15:00Z'), null);
  assert.equal(bilbobusPositionTimestamp('2026-03-29T01:15:00Z'), Date.parse('2026-03-29T00:15:00Z'));
});
test('SIRI arrivals preserve the official UTC record time and ignore stale predictions', () => {
  const xml = '<Envelope><Body><GetStopMonitoringResponse><GetStopMonitoringResult><MonitoredStopVisits><MonitoredStopVisit><RecordedAtTime>2026-10-02T13:52:21Z</RecordedAtTime><MonitoredVehicleJourney><VehicleRef>VEH_767</VehicleRef><LineRef>L18</LineRef><DirectionRef>Ida</DirectionRef><DestinationName>ZORROTZA</DestinationName><FramedVehicleJourneyRef><DatedVehicleJourneyRef>V011804_12</DatedVehicleJourneyRef></FramedVehicleJourneyRef><MonitoredCall><StopPointRef>1101</StopPointRef><ExpectedArrivalTime>2026-10-02T14:06:51Z</ExpectedArrivalTime></MonitoredCall></MonitoredVehicleJourney></MonitoredStopVisit></MonitoredStopVisits></GetStopMonitoringResult></GetStopMonitoringResponse></Body></Envelope>';
  const now = Date.parse('2026-10-02T13:52:30Z');
  const [arrival] = parseSiriArrivals(xml, '1101', now);
  assert.equal(arrival.vehicleId, '767'); assert.equal(arrival.directionId, 0);
  assert.equal(arrival.arrival, Date.parse('2026-10-02T14:06:51Z'));
  assert.equal(parseSiriArrivals(xml, '1101', now + 270_000).length, 0);
});
test('Observation speed uses meters and source milliseconds, rejecting actual anomalies only', () => {
  const tracker = new ObservationTracker();
  tracker.accept('bus', { at: 1000, progress: 0 }, 'bus', 1000);
  assert.equal(tracker.accept('bus', { at: 26000, progress: 250 }, 'bus', 26000)?.speed, 10);
  assert.equal(tracker.accept('bus', { at: 26000, progress: 250 }, 'bus', 30000)?.previous?.at, 1000);
  assert.equal(tracker.accept('bus', { at: 27000, progress: 2250 }, 'bus', 27000), null);
  assert.equal(tracker.accept('bus', { at: 51000, progress: 500 }, 'bus', 51000)?.speed, 10);
  assert.equal(tracker.accept('bus', { at: 330000, progress: 1500 }, 'bus', 330000)?.previous, null);
});

test('a bus without a usable fix in this poll stays where it was while its GPS is fresh', () => {
  // 14 Oct 2026: 779 rejected for 212 m backwards, 783/798/776 lost to a failed line request,
  // 745 left out of one reply. Each vanished from the map until a later poll.
  const at = Date.parse('2026-10-14T15:55:00Z');
  const bus = (vehicleId: string, observationTimestamp: number) => ({ id: `bilbobus:20261014:vehicle-${vehicleId}`, vehicleId, tripId: `t-${vehicleId}`, observationTimestamp, positionQuality: 'live' }) as TransitVehicle;
  const placed = new Map([['779', bus('779', at)], ['745', bus('745', at - 200_000)], ['611', bus('611', at - 280_000)], ['900', bus('900', at)]]);
  const kept = keepRecentlyPlaced(placed, new Set(['900']), at + 60_000);
  assert.deepEqual(kept.map((v) => [v.vehicleId, v.positionQuality, v.predictionTimestamp]), [['779', 'predicted', at + 60_000], ['745', 'predicted', at + 60_000]]);
  assert.ok(!placed.has('611'), 'a stale bus is forgotten');
});

test('Bilbobus official route progress disambiguates nearby shape segments and is GPS-validated', () => {
  const metric = buildShapeMetric([
    { latitude: 43, longitude: -2.001, sequence: 0 },
    { latitude: 43, longitude: -1.999, sequence: 1 },
    { latitude: 43.0001, longitude: -1.999, sequence: 2 },
    { latitude: 43.0001, longitude: -2.001, sequence: 3 },
  ]);
  const coordinate: [number, number] = [-2, 43.00009];
  const officialProgress = metric.cumulativeMeters[1] / 2;
  const nearest = projectOntoShape(metric, coordinate)!;
  const selected = bilbobusProgress(metric, coordinate, officialProgress)!;
  assert.ok(nearest.progressMeters > metric.cumulativeMeters[2], 'nearest point is on the return segment');
  assert.ok(Math.abs(selected.progressMeters - officialProgress) < .01, 'official progress keeps the correct outbound segment');
  assert.equal(selected.source, 'provider');
  const fallback = bilbobusProgress(metric, coordinate, metric.totalMeters + 1)!;
  assert.equal(fallback.source, 'gps');
  assert.equal(fallback.progressMeters, nearest.progressMeters);
});
