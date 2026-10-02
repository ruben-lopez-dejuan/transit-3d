import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import bindings from 'gtfs-realtime-bindings';
import { downloadFile } from './lib/download';

const directory = path.resolve('server/cache/audit');
const staticUrls = {
  'renfe-moveuskadi': 'https://opendata.euskadi.eus/transport/moveuskadi/renfe_cercanias/gtfs_renfe_cercanias.zip',
  'renfe-national': 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip',
};
for (const [name, url] of Object.entries(staticUrls)) {
  try {
    const file = path.join(directory, `${name}.zip`); await downloadFile(url, file);
    const zip = new AdmZip(file), counts: Record<string, number> = {};
    for (const table of ['agency', 'routes', 'trips', 'stops', 'stop_times', 'shapes', 'calendar', 'calendar_dates']) {
      const entry = zip.getEntry(`${table}.txt`); if (!entry) { counts[table] = 0; continue; }
      const rows = parse(entry.getData().toString('utf8'), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
      counts[table] = rows.length;
      if (['agency', 'routes'].includes(table)) console.log(name, table, JSON.stringify(rows.slice(0, 20)));
      if (table === 'trips') console.log(name, 'trip sample', JSON.stringify(rows.slice(0, 2)));
    }
    console.log(name, fs.statSync(file).size, counts);
  } catch (error) { console.log(name, String(error)); }
}
const feeds = {
  'renfe-tu': 'https://gtfsrt.renfe.com/trip_updates.pb',
  'renfe-vp': 'https://gtfsrt.renfe.com/vehicle_positions.pb',
  'bizkaibus-tu': 'https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_bizkaibus_trip_updates.pb',
  'euskotren-tu': 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfsrt_euskotren_trip_updates.pb',
  'metro-tu': 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfsrt_metro_bilbao_trip_updates.pb',
  'bilbobus-vp': 'https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfsrt_bilbobus_vehicle_positions.pb',
};
await Promise.all(Object.entries(feeds).map(async ([name, url]) => {
  try {
    const file = path.join(directory, `${name}.pb`); await downloadFile(url, file);
    const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(fs.readFileSync(file)), { longs: Number, enums: String });
    fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(feed));
    console.log(name, JSON.stringify({ bytes: fs.statSync(file).size, header: feed.header, entities: feed.entity?.length, sample: feed.entity?.[0] }));
  } catch (error) { console.log(name, String(error)); }
}));
