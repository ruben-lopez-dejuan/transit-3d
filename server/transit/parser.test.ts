import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGtfsDirectory } from '../providers/bizkaibus/gtfs';
import { isServiceActive } from './gtfsCalendar';

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
