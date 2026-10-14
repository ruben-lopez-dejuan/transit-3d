import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { EXTENSIONS_FILE, simplifyPath, straightMeters, type ShapeExtension } from './transit/routedSegments';

/**
 * Build reviewed shape extensions from the GTFS already cached under server/cache.
 *
 * Metro Bilbao publishes IBB_BSR (a late Ibarbengoa → Basauri trip) as a copy of
 * IBB_ETX: it ends at Etxebarri and leaves Ariz 1.5 km and Basauri 0.9 km off the
 * line. The parser only keeps the shapes the day's trips use, so the missing track
 * is copied here from a shape that does reach Basauri instead of looked up at runtime.
 *
 * Usage: npx tsx server/import-shape-extensions.ts
 */
type Lonlat = [number, number];
const DEFINITIONS: { operatorId: string; shapeId: string; donorShapeId: string; name: string }[] = [
  { operatorId: 'metro-bilbao', shapeId: 'IBB_BSR', donorShapeId: 'SIN_BSR', name: 'Etxebarri – Ariz – Basauri' },
];
const SNAP_METERS = 150;

const rows = (file: string) => parse(fs.readFileSync(file), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
const feeds = new Map<string, Map<string, Lonlat[]>>();
const shapesOf = (operatorId: string) => {
  if (feeds.has(operatorId)) return feeds.get(operatorId)!;
  const rowsBySequence = new Map<string, { sequence: number; point: Lonlat }[]>();
  for (const row of rows(path.resolve('server/cache', operatorId, 'shapes.txt'))) {
    if (!rowsBySequence.has(row.shape_id)) rowsBySequence.set(row.shape_id, []);
    rowsBySequence.get(row.shape_id)!.push({ sequence: Number(row.shape_pt_sequence), point: [Number(row.shape_pt_lon), Number(row.shape_pt_lat)] });
  }
  const shapes = new Map([...rowsBySequence].map(([id, points]) => [id, points.sort((a, b) => a.sequence - b.sequence).map(({ point }) => point)]));
  feeds.set(operatorId, shapes);
  return shapes;
};

const extensions: (ShapeExtension & { donorShapeId: string; meters: number })[] = DEFINITIONS.map((definition) => {
  const shapes = shapesOf(definition.operatorId);
  const target = shapes.get(definition.shapeId), donor = shapes.get(definition.donorShapeId);
  if (!target || !donor) throw new Error(`${definition.name}: shape ${target ? definition.donorShapeId : definition.shapeId} not in the cached feed`);
  const end = target.at(-1)!;
  const join = donor.reduce((best, point, i) => straightMeters(point, end) < straightMeters(donor[best], end) ? i : best, 0);
  if (straightMeters(donor[join], end) > SNAP_METERS) throw new Error(`${definition.name}: ${definition.donorShapeId} does not pass the end of ${definition.shapeId}`);
  const tail = donor.slice(join);
  if (tail.length < 2) throw new Error(`${definition.name}: ${definition.shapeId} already ends where ${definition.donorShapeId} does`);
  const meters = Math.round(tail.slice(1).reduce((sum, point, i) => sum + straightMeters(tail[i], point), 0));
  return { operatorId: definition.operatorId, shapeId: definition.shapeId, name: definition.name, donorShapeId: definition.donorShapeId, meters, path: simplifyPath(tail, 1).map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))] as Lonlat) };
});

const header = JSON.stringify({ source: 'Operator GTFS cached under server/cache', generatedAt: new Date().toISOString().slice(0, 10) }, null, 2).slice(0, -2);
fs.writeFileSync(EXTENSIONS_FILE, header + ',\n  "extensions": [\n' + extensions.map((extension) => '    ' + JSON.stringify(extension)).join(',\n') + '\n  ]\n}\n');
console.log(JSON.stringify(extensions.map(({ name, meters, path: points }) => ({ name, meters, points: points.length }))));
