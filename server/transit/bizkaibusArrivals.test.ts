import assert from 'node:assert/strict';
import test from 'node:test';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import type { LiveVehicle } from '../providers/bizkaibus/service';
import { matchPassingTimes, parsePassingTimes } from '../providers/bizkaibus/arrivals';

const escape = (xml: string) => xml.replace(/</g, '&lt;').replace(/>/g, '&gt;');
const response = (code: string, payload = '') => `<?xml version="1.0" encoding="utf-8"?><string xmlns="http://tempuri.org/LANTIK_TQWS/TQ">${code}®${escape(payload)}</string>`;
const passage = (line: string, destination: string, e1: [string, string], e2: [string, string]) => `<PasoParada><cabecera></cabecera><e1><minutos>${e1[0]}</minutos><metros>${e1[1]}</metros><tipo></tipo></e1><e2><minutos>${e2[0]}</minutos><metros>${e2[1]}</metros><tipo></tipo></e2><linea>${line}</linea><parada></parada><ruta>${destination}</ruta></PasoParada>`;

test('official passing times keep both buses per line and skip empty slots', () => {
  const xml = response('1', `<GetPasoParadaResult>${passage('A3414', 'GETXO', ['24', '8538'], ['42', '11228'])}${passage('A3471', 'GETXO', ['36', '10837'], ['', '0'])}</GetPasoParadaResult>`);
  assert.deepEqual(parsePassingTimes(xml), [
    { line: 'A3414', destination: 'GETXO', minutes: 24, meters: 8538 },
    { line: 'A3414', destination: 'GETXO', minutes: 42, meters: 11228 },
    { line: 'A3471', destination: 'GETXO', minutes: 36, meters: 10837 },
  ]);
  assert.throws(() => parsePassingTimes(response('90', 'Servicio no operativo')));
  assert.throws(() => parsePassingTimes('<html></html>'));
});

function fixture(): BizkaibusGtfs {
  return {
    routes: new Map([['r', { routeId: 'r', shortName: 'A1', longName: 'A – D', color: '', textColor: '', routeType: 3 }]]),
    trips: new Map([['t1', { tripId: 't1', routeId: 'r', serviceId: 's', shapeId: 'shape', headsign: 'Dénia', directionId: 0 }], ['t2', { tripId: 't2', routeId: 'r', serviceId: 's', shapeId: 'shape', headsign: 'DENIA', directionId: 0 }]]),
    stops: new Map(['a', 'b', 'c', 'd'].map((stopId, i) => [stopId, { stopId, stopCode: `4800${i}`, name: stopId, latitude: 43.26, longitude: -2.94 + i * 0.01 }])),
    shapes: new Map([['shape', [0, 1, 2, 3].map((i) => ({ latitude: 43.26, longitude: -2.94 + i * 0.01, sequence: i }))]]),
    tripStops: new Map(['t1', 't2'].map((tripId) => [tripId, ['a', 'b', 'c', 'd'].map((stopId, i) => ({ stopId, sequence: i + 1, arrivalTime: `10:${String(i * 10).padStart(2, '0')}:00`, departureTime: `10:${String(i * 10).padStart(2, '0')}:00` }))])),
    routeTripIds: new Map([['r', ['t1', 't2']]]), calendars: new Map([['s', { serviceId: 's', startDate: '20260101', endDate: '20261231', weekdays: [true, true, true, true, true, true, true] }]]), calendarDates: new Map(),
  };
}
const vehicle = (vehicleId: string, tripId: string, progress: number, headsign: string) => ({ vehicleId, tripId, routeId: 'r', headsign, directionId: 0, shapeId: 'shape', progressMetersAlongShape: progress }) as LiveVehicle;

test('passing times are paired with the GPS bus whose distance to the stop matches', () => {
  const gtfs = fixture(), at = Date.parse('2026-10-14T14:40:00Z');
  const vehicles = [vehicle('far', 't1', 100, 'Dénia'), vehicle('near', 't2', 1700, 'DENIA'), vehicle('passed', 't1', 2500, 'Dénia')];
  const rows = matchPassingTimes(gtfs, 'd', [
    { line: 'A1', destination: 'DENIA', minutes: 2, meters: 600 },
    { line: 'A1', destination: 'DENIA', minutes: 9, meters: 2100 },
    { line: 'A1', destination: 'OTRO', minutes: 4, meters: 700 },
    { line: 'A9', destination: 'DENIA', minutes: 5, meters: 700 },
  ], vehicles, at);
  assert.deepEqual(rows.map((row) => row.vehicleId), ['near', 'far', null, null]);
  assert.equal(rows[0].tripId, 't2'); assert.equal(rows[0].arrival, at + 120_000);
  assert.equal(rows[2].routeId, 'r', 'an unmatched row of a known line still names its route');
  assert.equal(rows[3].routeId, null);
});

test('a passing time far from every GPS distance is not attributed to a bus', () => {
  const rows = matchPassingTimes(fixture(), 'd', [{ line: 'A1', destination: 'DENIA', minutes: 30, meters: 9000 }], [vehicle('near', 't2', 1700, 'DENIA')], 0);
  assert.equal(rows[0].vehicleId, null);
});
