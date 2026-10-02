import assert from 'node:assert/strict';
import test from 'node:test';
import { shapeMetric, tripPlan, timelineFor, serviceEpoch, shapePacket, modeFor } from './plans';
import { generateScheduledVehicles } from './scheduled';
import { passengerHeadsign, placeShortcuts } from './labels';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { infrastructureFor } from './infrastructure';

function fixture(longitude = 0): BizkaibusGtfs {
  return {
    routes: new Map([['r', { routeId: 'r', shortName: '1', longName: 'Line', color: '', textColor: '', routeType: 1 }]]),
    trips: new Map([['t', { tripId: 't', routeId: 'r', shapeId: 's', serviceId: 'daily', headsign: 'End', directionId: 0 }]]),
    shapes: new Map([['s', [0, 1, 2].map((n) => ({ longitude: longitude + n * .001, latitude: 0, sequence: n + 1 }))]]),
    stops: new Map([0, 1, 2].map((n) => [String(n), { stopId: String(n), stopCode: '', name: String(n), longitude: longitude + n * .001, latitude: 0 }])),
    tripStops: new Map([['t', [
      { stopId: '0', sequence: 1, arrivalTime: '09:00:00', departureTime: '09:00:00' },
      { stopId: '1', sequence: 2, arrivalTime: '09:10:00', departureTime: '09:12:00' },
      { stopId: '2', sequence: 3, arrivalTime: '09:22:00', departureTime: '09:22:00' },
    ]]]), routeTripIds: new Map([['r', ['t']]]),
    calendars: new Map([['daily', { serviceId: 'daily', startDate: '20260101', endDate: '20261231', weekdays: Array(7).fill(true) }]]), calendarDates: new Map(),
  };
}
test('passenger labels remove timetable metadata while retaining the actual destination', () => {
  assert.equal(passengerHeadsign('PT-Semana/(PLAZA ELÍPTICA) - IDA - X'), 'PLAZA ELÍPTICA');
  assert.equal(passengerHeadsign('PT-Semana / (TXURDINAGA)'), 'TXURDINAGA');
  assert.equal(passengerHeadsign('Zazpikaleak/Casco Viejo'), 'Zazpikaleak/Casco Viejo');
  assert.equal(passengerHeadsign('PT-BT-SEM-IDA', 'Intermodal'), 'Intermodal');
});
test('landmark shortcuts prefer the exact Bilbao station over similarly named suburban stops', () => {
  const fields = { key: '', operatorId: '', stopId: '' };
  const places = placeShortcuts([
    { ...fields, name: 'SAN MAMÉS (1060)', longitude: -3.096, latitude: 43.35, modes: ['bus'] },
    { ...fields, name: 'ALAMEDA SAN MAMÉS 8', longitude: -2.935, latitude: 43.257, modes: ['bus'] },
    { ...fields, name: 'San Mamés', longitude: -2.94751, latitude: 43.26252, modes: ['rail'] },
  ]);
  assert.equal(places.find((p) => p.name === 'San Mamés')?.longitude, -2.94751);
});
test('identical shape/trip IDs from different feeds do not share cached geometry', () => {
  const one = fixture(0), two = fixture(1);
  assert.equal(shapeMetric(one, 's')!.coordinates[0][0], 0);
  assert.equal(shapeMetric(two, 's')!.coordinates[0][0], 1);
  assert.notEqual(tripPlan(one, 't'), tripPlan(two, 't'));
  assert.equal(tripPlan(one, 't'), tripPlan(one, 't'));
  assert.equal(shapePacket(shapeMetric(two, 's')!, 'two:s').key, 'two:s');
});

test('shape packets preserve short corners before long segments', () => {
  const points = [[0, 0], [.00005, 0], [.00005, .01]].map(([longitude, latitude], sequence) => ({ longitude, latitude, sequence }));
  const gtfs = fixture(); gtfs.shapes.set('corner', points);
  assert.equal(shapePacket(shapeMetric(gtfs, 'corner')!, 'corner').coordinates.length, 3);
});

test('Metro tunnel metadata includes the GTFS Eliptikoa name and excludes Urbinaga viaduct', () => {
  const metro = fixture();
  ['Abando', 'Eliptikoa', 'Indautxu'].forEach((name, i) => { metro.stops.get(String(i))!.name = name; });
  const ranges = infrastructureFor(metro, 'metro-bilbao', 's')!;
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].to > ranges[0].from);
  assert.equal(ranges[0].approximate, true);
  assert.deepEqual(infrastructureFor(metro, 'euskotren', 's'), []);
  const viaduct = fixture();
  ['Bagatza', 'Urbinaga', 'Sestao'].forEach((name, i) => { viaduct.stops.get(String(i))!.name = name; });
  assert.deepEqual(infrastructureFor(viaduct, 'metro-bilbao', 's'), []);
});
test('trip timelines retain dwell, and delay shifts every stop without changing progress', () => {
  const plan = tripPlan(fixture(), 't')!;
  assert.equal(plan.anchors.length, 4);
  assert.equal(plan.anchors[1].progress, plan.anchors[2].progress);
  const scheduled = timelineFor(plan, '20261002'), delayed = timelineFor(plan, '20261002', 120);
  scheduled.forEach((a, i) => { assert.equal(delayed[i].at - a.at, 120000); assert.equal(delayed[i].progress, a.progress); });
});
test('GTFS epoch uses local noon minus 12h across DST changes and extended hours', () => {
  assert.equal(new Date(serviceEpoch('20261002', 9 * 3600)).toISOString(), '2026-10-02T07:00:00.000Z');
  assert.equal(new Date(serviceEpoch('20260329', 0)).toISOString(), '2026-03-28T22:00:00.000Z');
  assert.equal(new Date(serviceEpoch('20261025', 0)).toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(serviceEpoch('20261002', 25 * 3600) - serviceEpoch('20261002', 0), 25 * 3600000);
});
test('active service past midnight retains the previous service-day identity', () => {
  const gtfs = fixture();
  gtfs.tripStops.set('t', [
    { stopId: '0', sequence: 1, arrivalTime: '24:10:00', departureTime: '24:10:00' },
    { stopId: '2', sequence: 2, arrivalTime: '25:10:00', departureTime: '25:10:00' },
  ]);
  const [vehicle] = generateScheduledVehicles(gtfs, new Date('2026-10-02T22:40:00Z'), 'operator');
  assert.equal(vehicle.id, 'operator:20261002:t');
  assert.equal(vehicle.positionQuality, 'scheduled');
  assert.ok(Math.abs(vehicle.longitude - .001) < .00001);
});
test('route types normalize standard and extended bus/rail/tram modes', () => {
  assert.equal(modeFor(3), 'bus'); assert.equal(modeFor(700), 'bus');
  assert.equal(modeFor(1), 'rail'); assert.equal(modeFor(109), 'rail');
  assert.equal(modeFor(0), 'tram'); assert.equal(modeFor(900), 'tram'); assert.equal(modeFor(4), 'unknown');
});
test('scheduled positions and presentation epochs agree on a DST transition day', () => {
  const gtfs = fixture();
  gtfs.tripStops.set('t', [
    { stopId: '0', sequence: 1, arrivalTime: '00:30:00', departureTime: '00:30:00' },
    { stopId: '2', sequence: 2, arrivalTime: '02:30:00', departureTime: '02:30:00' },
  ]);
  const now = new Date(serviceEpoch('20260329', 1.5 * 3600));
  const [vehicle] = generateScheduledVehicles(gtfs, now, 'operator');
  assert.equal(vehicle.id, 'operator:20260329:t');
  assert.ok(Math.abs(vehicle.longitude - .001) < .00001);
});
