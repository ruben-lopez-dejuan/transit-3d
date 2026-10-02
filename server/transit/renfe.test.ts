import assert from 'node:assert/strict';
import test from 'node:test';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { prepareRenfeBilbao } from '../providers/renfe';
import { tripPlan } from './plans';

test('Renfe selects Bilbao stations, reverses published shapes, and preserves trip IDs', () => {
  const data: BizkaibusGtfs = {
    routes: new Map(['60T0001C1', '10T0001C1', '60T0021C4'].map((id) => [id, { routeId: id, shortName: 'C1', longName: 'Abando    - Santurtzi', color: 'D7001E', textColor: 'FFFFFF', routeType: 2 }])),
    trips: new Map([['bilbao', { tripId: 'bilbao', routeId: '60T0001C1', serviceId: 's', headsign: '', shapeId: 'shape', directionId: null }], ['madrid', { tripId: 'madrid', routeId: '10T0001C1', serviceId: 's', headsign: '', shapeId: 'shape', directionId: null }], ['leon', { tripId: 'leon', routeId: '60T0021C4', serviceId: 's', headsign: '', shapeId: 'shape', directionId: null }]]),
    shapes: new Map([['shape', [{ latitude: 43.26, longitude: -2.94, sequence: 0 }, { latitude: 43.26, longitude: -2.93, sequence: 1 }]]]),
    stops: new Map([['a', { stopId: 'a', stopCode: '', name: 'Abando', latitude: 43.26, longitude: -2.93 }], ['b', { stopId: 'b', stopCode: '', name: 'Destino', latitude: 43.26, longitude: -2.94 }], ['l', { stopId: 'l', stopCode: '', name: 'León', latitude: 42.6, longitude: -5.5 }]]),
    tripStops: new Map([['bilbao', [{ stopId: 'a', sequence: 1, arrivalTime: '10:00:00', departureTime: '10:00:00' }, { stopId: 'b', sequence: 2, arrivalTime: '10:10:00', departureTime: '10:10:00' }]], ['madrid', [{ stopId: 'a', sequence: 1, arrivalTime: '10:00:00', departureTime: '10:00:00' }]], ['leon', [{ stopId: 'l', sequence: 1, arrivalTime: '10:00:00', departureTime: '10:00:00' }]]]),
    routeTripIds: new Map(), calendars: new Map(), calendarDates: new Map(),
  };
  prepareRenfeBilbao(data);
  assert.deepEqual([...data.trips.keys()], ['bilbao']);
  assert.deepEqual([...data.routes.keys()], ['60T0001C1']);
  assert.equal(data.trips.get('bilbao')?.shapeId, 'shape:reverse');
  assert.equal(data.trips.get('bilbao')?.headsign, 'Destino');
  const plan = tripPlan(data, 'bilbao')!;
  assert.ok(plan.stops[1].progress > plan.stops[0].progress);
  assert.equal(data.stops.has('l'), false);
});
