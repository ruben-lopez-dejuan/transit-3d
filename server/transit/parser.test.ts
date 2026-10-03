import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGtfsDirectory } from '../providers/bizkaibus/gtfs';
import { isServiceActive } from './gtfsCalendar';
import { expandFrequencies } from './frequencies';

test('GTFS parser handles quoted labels, missing optional calendar and unsorted rows', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilbao-gtfs-test-'));
  const tables = {
    routes: '\ufeffroute_id,route_short_name,route_long_name,route_type\nr,1,"Bilbao, estación",1\n',
    trips: 'route_id,service_id,trip_id,trip_headsign,shape_id    \nr,special,t,End,shape    \n',
    stops: 'stop_id,stop_name,stop_lat,stop_lon\na,"San Mamés, estación",43.26,-2.95\nb,Abando,43.26,-2.94\n',
    stop_times: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,25:30:00,25:31:00,b,2\nt,24:10:00,24:12:00,a,1\n',
    shapes: 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape,43.26,-2.94,2\nshape,43.26,-2.95,1\n',
    calendar_dates: 'service_id,date,exception_type\nspecial,20261002,1\nspecial,20261003,2\n',
  };
  try {
    Object.entries(tables).forEach(([name, csv]) => fs.writeFileSync(path.join(directory, `${name}.txt`), csv));
    const feed = parseGtfsDirectory(directory);
    assert.equal(feed.routes.get('r')?.longName, 'Bilbao, estación');
    assert.equal(feed.trips.get('t')?.directionId, null);
    assert.equal(feed.trips.get('t')?.shapeId, 'shape');
    assert.equal(feed.stops.get('a')?.name, 'San Mamés, estación');
    assert.equal(feed.tripStops.get('t')?.[0].stopId, 'a');
    assert.equal(feed.shapes.get('shape')?.[0].longitude, -2.95);
    assert.equal(feed.calendars.size, 0);
    assert.equal(isServiceActive(feed, 'special', '20261002', 4), true);
    assert.equal(isServiceActive(feed, 'special', '20261003', 5), false);
  } finally {
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(path.resolve(directory).startsWith(`${tempRoot}${path.sep}`));
    assert.ok(path.basename(directory).startsWith('bilbao-gtfs-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency trips replace templates, preserve dwell and expand past midnight without an end-time departure', () => {
  const feed = { trips: new Map([['t', { tripId: 't', routeId: 'r', serviceId: 's', shapeId: 'x', directionId: 0, headsign: 'B' }]]), routeTripIds: new Map([['r', ['t']]]), tripStops: new Map([['t', [{ stopId: 'a', sequence: 1, arrivalTime: '00:00:00', departureTime: '00:00:00' }, { stopId: 'b', sequence: 2, arrivalTime: '00:03:00', departureTime: '00:04:00' }]]]) } as unknown as import('../providers/bizkaibus/gtfs').BizkaibusGtfs;
  expandFrequencies(feed, [{ trip_id: 't', start_time: '23:50:00', end_time: '24:20:00', headway_secs: '600' }]);
  assert.equal(feed.trips.has('t'), false);
  assert.equal(feed.trips.size, 3);
  assert.equal(feed.tripStops.get('t@86400')?.[1].departureTime, '24:04:00');
  assert.equal(feed.trips.has('t@87600'), false);
  assert.equal(feed.routeTripIds.get('r')?.length, 3);
});


test('route filtering discards unrelated stops and shapes while parsing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filtered-gtfs-test-'));
  const tables = {
    routes: 'route_id,route_short_name,route_type\nr,1,3\nother,2,3\n',
    trips: 'route_id,service_id,trip_id,shape_id\nr,s,t,shape\nother,s,x,unused\n',
    stops: 'stop_id,stop_name,stop_lat,stop_lon\na,A,43,-2\nz,Z,44,-3\n',
    stop_times: 'trip_id,stop_id,stop_sequence\nt,a,1\nx,z,1\n',
    shapes: 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape,43,-2,1\nshape,43.1,-2.1,2\nunused,44,-3,1\nunused,44.1,-3.1,2\n',
  };
  try {
    Object.entries(tables).forEach(([name, csv]) => fs.writeFileSync(path.join(directory, `${name}.txt`), csv));
    const feed = parseGtfsDirectory(directory, (route) => route.routeId === 'r');
    assert.deepEqual([...feed.trips.keys()], ['t']);
    assert.deepEqual([...feed.stops.keys()], ['a']);
    assert.deepEqual([...feed.shapes.keys()], ['shape']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
