import fs from 'node:fs';
import path from 'node:path';
import type { BizkaibusGtfs } from '../bizkaibus/gtfs';
import { downloadFile } from '../../lib/download';
import { distanceMeters, type Coordinate } from '../../transit/motionEngine';

/** Verified CRTM catalogue item 63d4ed4b069342f8b3ec959e042ee78b. */
export const METRO_TOPOLOGY_SERVICE = 'https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/M4_Lineas/FeatureServer';
export const L3_TOPOLOGY_LAYERS = [20, 22, 24, 26] as const;
type StationFeature = { attributes: { CODIGOESTACION: string; DENOMINACION: string }; geometry: { x: number; y: number } };
type SegmentFeature = { attributes: { CODIGOESTACION: string; NUMEROORDEN: number; IDFLINEA: string; SENTIDO: string }; geometry: { paths: Coordinate[][] } };
export type TopologyDocument = { features: (StationFeature | SegmentFeature)[]; exceededTransferLimit?: boolean; error?: unknown };
const coordinate = (p: Coordinate) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > -5 && p[0] < -2 && p[1] > 39 && p[1] < 42;

/** Atomic addition: official station IDs/order and curved geometry, no straight-line reconstruction. */
export function installMetroTopology(gtfs: BizkaibusGtfs, stationsDoc: TopologyDocument, segmentsDoc: TopologyDocument) {
  if (stationsDoc.error || segmentsDoc.error || stationsDoc.exceededTransferLimit || segmentsDoc.exceededTransferLimit) throw new Error('Topología CRTM incompleta');
  const stations = stationsDoc.features as StationFeature[], segments = [...segmentsDoc.features] as SegmentFeature[];
  if (stations.length < 2 || stations.length > 100 || segments.length !== stations.length - 1) throw new Error('Relaciones de estaciones CRTM inválidas');
  const byCode = new Map(stations.map((s) => [String(s.attributes.CODIGOESTACION), s]));
  if (byCode.size !== stations.length || stations.some((s) => !s.attributes.DENOMINACION || !coordinate([s.geometry.x, s.geometry.y]))) throw new Error('Estaciones CRTM inválidas');
  segments.sort((a, b) => a.attributes.NUMEROORDEN - b.attributes.NUMEROORDEN);
  const { IDFLINEA: routeId, SENTIDO: direction } = segments[0].attributes;
  if (!gtfs.routes.has(routeId) || !['1', '2'].includes(String(direction)) || segments.some((s, i) => s.attributes.IDFLINEA !== routeId || String(s.attributes.SENTIDO) !== String(direction) || s.attributes.NUMEROORDEN !== i + 2 || !byCode.has(String(s.attributes.CODIGOESTACION)))) throw new Error('Orden CRTM inválido');
  const destinations = new Set(segments.map((s) => String(s.attributes.CODIGOESTACION)));
  const origin = stations.filter((s) => !destinations.has(String(s.attributes.CODIGOESTACION)));
  if (origin.length !== 1 || destinations.size !== segments.length) throw new Error('Sentido CRTM ambiguo');
  const ordered = [origin[0], ...segments.map((s) => byCode.get(String(s.attributes.CODIGOESTACION))!)];
  const points: Coordinate[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.geometry.paths.length !== 1) throw new Error('Tramo CRTM discontinuo');
    const line = [...segment.geometry.paths[0]];
    if (line.length < 2 || line.some((p) => !coordinate(p))) throw new Error('Geometría CRTM inválida');
    const previous: Coordinate = points.at(-1) ?? [ordered[index].geometry.x, ordered[index].geometry.y];
    if (distanceMeters(previous, line.at(-1)!) < distanceMeters(previous, line[0])) line.reverse();
    const end: Coordinate = [ordered[index + 1].geometry.x, ordered[index + 1].geometry.y];
    // Station points describe the interchange, not the platform (Legazpi is
    // 151 m from its official segment endpoint). Segment-to-segment joins stay strict.
    if (distanceMeters(previous, line[0]) > 150 || distanceMeters(end, line.at(-1)!) > 250) throw new Error('Tramo CRTM no asociado a sus estaciones');
    points.push(...(points.length && distanceMeters(previous, line[0]) < 1 ? line.slice(1) : line));
  }
  const tripId = `topology:${routeId}:${direction}`, shapeId = tripId + ':shape';
  for (const s of ordered) {
    const stopId = 'par_4_' + s.attributes.CODIGOESTACION;
    gtfs.stops.set(stopId, { stopId, stopCode: String(s.attributes.CODIGOESTACION), name: s.attributes.DENOMINACION, longitude: s.geometry.x, latitude: s.geometry.y });
  }
  gtfs.shapes.set(shapeId, points.map(([longitude, latitude], sequence) => ({ longitude, latitude, sequence })));
  gtfs.trips.set(tripId, { tripId, routeId, directionId: Number(direction) - 1, shapeId, headsign: ordered.at(-1)!.attributes.DENOMINACION, serviceId: 'topology-only' });
  // Zero offsets make the common geometry plan usable. No calendar activates this
  // template; native arrivals are the ONLY passenger times and motion anchors.
  gtfs.tripStops.set(tripId, ordered.map((s, i) => ({ stopId: 'par_4_' + s.attributes.CODIGOESTACION, sequence: i + 1, arrivalTime: '00:00:00', departureTime: '00:00:00' })));
  const ids = gtfs.routeTripIds.get(routeId) ?? [];
  if (!ids.includes(tripId)) ids.push(tripId);
  gtfs.routeTripIds.set(routeId, ids);
}

export async function completeMetroTopology(gtfs: BizkaibusGtfs) {
  // L3 has no trips/shapes at all in the verified CRTM GTFS. Other GTFS geometry stays intact.
  if ((gtfs.routeTripIds.get('4__3___') ?? []).length) return;
  const documents = await Promise.all(L3_TOPOLOGY_LAYERS.map(async (layer) => {
    const file = path.resolve(`server/cache/madrid/topology-${layer}.json`), candidate = file + '.candidate';
    const read = (name: string): TopologyDocument => {
      const doc = JSON.parse(fs.readFileSync(name, 'utf8')) as TopologyDocument;
      if (!Array.isArray(doc.features) || !doc.features.length || doc.error || doc.exceededTransferLimit) throw new Error('Respuesta CRTM inválida');
      return doc;
    };
    if (!fs.existsSync(file) || Date.now() - fs.statSync(file).mtimeMs > 6 * 3600_000) {
      try {
        await downloadFile(`${METRO_TOPOLOGY_SERVICE}/${layer}/query?f=json&where=1%3D1&outFields=*&outSR=4326&returnGeometry=true`, candidate);
        read(candidate); fs.renameSync(candidate, file);
      } catch { if (!fs.existsSync(file)) throw new Error('No se pudo obtener la topología oficial de L3'); }
      finally { fs.rmSync(candidate, { force: true }); }
    }
    return read(file);
  }));
  installMetroTopology(gtfs, documents[0], documents[1]);
  installMetroTopology(gtfs, documents[2], documents[3]);
}
