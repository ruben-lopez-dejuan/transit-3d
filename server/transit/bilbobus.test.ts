import assert from 'node:assert/strict';
import test from 'node:test';
import { bilbobusPositionTimestamp, ed50ToWgs84, parseSiriArrivals } from '../providers/bilbobus';
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
  assert.equal(parseSiriArrivals(xml, '1101', now + 180_000).length, 0);
});
test('Observation speed uses meters and source milliseconds, rejecting actual anomalies only', () => {
  const tracker = new ObservationTracker();
  tracker.accept('bus', { at: 1000, progress: 0 }, 'bus', 1000);
  assert.equal(tracker.accept('bus', { at: 26000, progress: 250 }, 'bus', 26000)?.speed, 10);
  assert.equal(tracker.accept('bus', { at: 26000, progress: 250 }, 'bus', 30000)?.previous?.at, 1000);
  assert.equal(tracker.accept('bus', { at: 27000, progress: 2250 }, 'bus', 27000), null);
  assert.equal(tracker.accept('bus', { at: 51000, progress: 500 }, 'bus', 51000)?.speed, 10);
  assert.equal(tracker.accept('bus', { at: 250000, progress: 1500 }, 'bus', 250000)?.previous, null);
});
