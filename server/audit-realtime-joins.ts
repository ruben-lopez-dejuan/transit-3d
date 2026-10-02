import fs from 'node:fs';
import { renfeProvider } from './providers/renfe';
import { StaticGtfsProvider } from './providers/staticGtfs';
import { getBizkaibusGtfs } from './providers/bizkaibus/gtfs';
import { tripPlan } from './transit/plans';
import { normalizeTripUpdates } from './transit/realtime';

const sources = [
  { id: 'renfe', file: 'renfe', data: renfeProvider.getGtfs() },
  { id: 'bizkaibus', file: 'bizkaibus', data: getBizkaibusGtfs() },
  { id: 'metro-bilbao', file: 'metro', data: new StaticGtfsProvider('metro-bilbao', 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip').getGtfs() },
  { id: 'euskotren', file: 'euskotren', data: new StaticGtfsProvider('euskotren', 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip').getGtfs() },
];
for (const source of sources) {
  const data = await source.data;
  const feed = JSON.parse(fs.readFileSync(`server/cache/audit/${source.file}-tu.json`, 'utf8'));
  const updates = feed.entity.map((e: any) => e.tripUpdate).filter(Boolean);
  const matches = updates.filter((u: any) => data.trips.has(u.trip.tripId));
  const stopMatches = matches.filter((u: any) => u.stopTimeUpdate?.every((s: any) => (data.tripStops.get(u.trip.tripId) ?? []).some((t) => (!s.stopId || s.stopId === t.stopId) && (s.stopSequence === undefined || s.stopSequence === t.sequence))));
  console.log(source.id, { routes: data.routes.size, trips: data.trips.size, shapes: data.shapes.size, stops: data.stops.size, updates: updates.length, matchingTrips: matches.length, matchingAllStops: stopMatches.length });
  console.log('normalized timetable instances', normalizeTripUpdates(data, feed, new Date(feed.header.timestamp * 1000)).size);
  console.log('sample unmatched', JSON.stringify(updates.filter((u: any) => !data.trips.has(u.trip.tripId)).slice(0, 1)));
  if (source.id === 'renfe') {
    console.log('renfe route plans', [...data.routes.values()].map((r) => ({ route: r.routeId, name: r.shortName, trips: data.routeTripIds.get(r.routeId)?.length, plans: (data.routeTripIds.get(r.routeId) ?? []).filter((id) => tripPlan(data, id)).length })));
    const gps = JSON.parse(fs.readFileSync('server/cache/audit/renfe-vp.json', 'utf8'));
    console.log('renfe matching GPS', gps.entity.filter((e: any) => data.trips.has(e.vehicle?.trip?.tripId)).length);
  }
}
