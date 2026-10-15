import { Map, LngLatBounds, type GeoJSONSource } from 'maplibre-gl';
import type { Network, Shape, Stop } from '../transit/networkTypes';
import { vehicleKind } from './vehicleLod';
import { bodyFor, compositionFor, liveryFor, type StyledVehicle } from '../../shared/transit/appearance';
import type { CabShape, VehicleBody, VehicleLivery } from '../../shared/transit/contracts';

export const empty = { type: 'FeatureCollection' as const, features: [] };
export const styleUrl = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
export function setData(map: Map, id: string, data: unknown) { (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never); }
export function stopsData(stops: Stop[]) { return { type: 'FeatureCollection' as const, features: stops.map((s) => ({ type: 'Feature' as const, properties: { key: s.key, name: s.name, station: s.modes.some((m) => m === 'rail' || m === 'tram' || m === 'funicular'), operator: s.operatorId, modes: s.modes.join(',') }, geometry: { type: 'Point' as const, coordinates: [s.longitude, s.latitude] } })) }; }
export function routeData(shapes: Shape[], color: string) { return { type: 'FeatureCollection' as const, features: shapes.map((s) => ({ type: 'Feature' as const, properties: { color }, geometry: { type: 'LineString' as const, coordinates: s.coordinates } })) }; }
export function installLayers(map: Map, network: Network | null, dark: boolean) {
  if (map.getSource('vehicles')) return;
  const sources = ['selected-vehicle', 'vehicle-bodies', 'selected-route', 'selected-stops', 'user-location'];
  for (const id of sources) map.addSource(id, { type: 'geojson', data: empty });
  map.addSource('stops', { type: 'geojson', data: network ? stopsData(network.stops) : empty });
  map.addSource('vehicles', { type: 'geojson', data: empty, cluster: true, clusterMaxZoom: 10, clusterRadius: 42 });
  const white = dark ? '#202b31' : '#ffffff';
  const building = map.getStyle().layers?.find((layer) => layer.type === 'fill' && layer['source-layer'] === 'building');
  if (building && 'source' in building) map.addLayer({ id: 'transit-buildings', type: 'fill-extrusion', source: building.source, 'source-layer': 'building', minzoom: 15.5, paint: { 'fill-extrusion-color': dark ? '#29383d' : '#d0d9d2', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 3], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .6 } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'selected-route', paint: { 'line-color': white, 'line-width': 9, 'line-opacity': .9 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'selected-route', paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': .9 } });
  map.addLayer({ id: 'stations', type: 'circle', source: 'stops', minzoom: 11, filter: ['==', ['get', 'station'], true], paint: { 'circle-radius': 4, 'circle-color': white, 'circle-stroke-color': '#6a7b83', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'bus-stops', type: 'circle', source: 'stops', minzoom: 14, filter: ['==', ['get', 'station'], false], paint: { 'circle-radius': 3, 'circle-color': white, 'circle-stroke-color': '#84959d', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 16, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 15 }, paint: { 'text-color': dark ? '#d2dce1' : '#43545b', 'text-halo-color': white, 'text-halo-width': 2 } });
  map.addLayer({ id: 'selected-stops-dot', type: 'circle', source: 'selected-stops', paint: { 'circle-radius': 5, 'circle-color': white, 'circle-stroke-color': '#197861', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'selected-stops-label', type: 'symbol', source: 'selected-stops', minzoom: 13, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': dark ? '#eff5f7' : '#253b43', 'text-halo-color': white, 'text-halo-width': 2 } });
  map.addLayer({ id: 'clusters', type: 'circle', source: 'vehicles', maxzoom: 11, filter: ['has', 'point_count'], paint: { 'circle-color': '#226b59', 'circle-radius': ['step', ['get', 'point_count'], 19, 20, 24, 100, 29], 'circle-stroke-color': white, 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'vehicles', maxzoom: 11, filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#ffffff' } });
  installVehicleIcons(map, network?.routes ?? []);
  map.addLayer({ id: 'selected-halo', type: 'circle', source: 'selected-vehicle', paint: { 'circle-radius': 8, 'circle-opacity': 0, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.2, 'circle-stroke-opacity': .6 } });
  map.addLayer({ id: 'vehicle-dot', type: 'circle', source: 'vehicles', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 12, 'circle-opacity': 0 } });
  map.addLayer({ id: 'vehicle-icon', type: 'symbol', source: 'vehicles', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], ...ICON_SIZE_STOPS.flat()], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'buried'], 0], 0, 1, 1, .45], 'icon-opacity-transition': { duration: 0, delay: 0 } } });
  map.addLayer({ id: 'vehicle-label', type: 'symbol', source: 'vehicles', minzoom: 12.5, filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['step', ['zoom'], ['get', 'label'], 14.5, ['concat', ['get', 'label'], ' · ', ['get', 'destination']], 16, ['concat', ['get', 'label'], ' · ', ['get', 'destination'], ['case', ['get', 'underground'], ' · túnel', '']]], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 2], 'text-anchor': 'top', 'text-max-width': 22, 'text-allow-overlap': false, 'symbol-sort-key': ['case', ['get', 'selected'], 0, 1] }, paint: { 'text-color': dark ? '#eff5f7' : '#243c3b', 'text-halo-color': white, 'text-halo-width': 2 } });
  map.addLayer({ id: 'location-halo', type: 'circle', source: 'user-location', paint: { 'circle-radius': 18, 'circle-color': '#3185e6', 'circle-opacity': .15 } });
  map.addLayer({ id: 'location-dot', type: 'circle', source: 'user-location', paint: { 'circle-radius': 6, 'circle-color': '#3185e6', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
}
export function fitShapes(map: Map, shapes: Shape[], padding: { top: number; bottom: number; left: number; right: number }, duration = 850) {
  map.resize();
  const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
  const x = Math.min(1, Math.max(0, width - 100) / (padding.left + padding.right));
  const y = Math.min(1, Math.max(0, height - 100) / (padding.top + padding.bottom));
  padding = { left: padding.left * x, right: padding.right * x, top: padding.top * y, bottom: padding.bottom * y };
  const bounds = new LngLatBounds(); shapes.forEach((s) => s.coordinates.forEach((c) => bounds.extend(c)));
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding, maxZoom: 15, duration });
}

type IconVehicle = StyledVehicle & { color: string };
/** One image per kind, consist, livery and car shape: the icon shows the real number of cars in the fleet's paint. */
export function vehicleIconId(vehicle: IconVehicle) {
  const livery = liveryFor(vehicle), body = bodyFor(vehicle);
  const { count, length } = compositionFor(vehicle);
  return `${vehicleKind(vehicle)}-${count}x${length}-${livery.body}-${livery.accent}-${livery.front ?? ''}-${livery.band ?? 'thin'}-${body.cab}${body.doors}`;
}
const shade = (hex: string, amount: number) => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 + amount))));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};
/** Pixel geometry of a vehicle's icon image, before the zoom-dependent icon-size. */
function iconGeometry(kind: ReturnType<typeof vehicleKind>, { count, length }: { count: number; length: number }) {
  // Rail keeps its proportions; a bus is drawn larger than scale so it stays readable among trains.
  const pixelsPerMeter = kind === 'bus' ? 5.3 : kind === 'tram' ? 3.6 : 2.1;
  const carLength = Math.max(18, Math.round(length * pixelsPerMeter));
  const width = kind === 'bus' ? 26 : kind === 'tram' ? 24 : 27, gap = kind === 'tram' ? 2 : 4;
  return { carLength, width, gap, height: 6 + count * carLength + (count - 1) * gap };
}
/** icon-size of the vehicle layer by zoom; hit testing uses the same curve. */
const ICON_SIZE_STOPS: [number, number][] = [[10, .25], [13, .38], [16, .52], [18, .7]];
export function iconSize(zoom: number) {
  const stops = ICON_SIZE_STOPS;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (zoom <= stops[i][0]) return stops[i - 1][1] + (stops[i][1] - stops[i - 1][1]) * (zoom - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
  return stops.at(-1)![1];
}
/** Length and width on screen, in pixels, of the icon drawn for this vehicle at this zoom. */
export function vehicleIconPixels(vehicle: IconVehicle, zoom: number) {
  const { height, width } = iconGeometry(vehicleKind(vehicle), compositionFor(vehicle)), size = iconSize(zoom);
  return { length: height * size, width: (width + 4) * size };
}
type End = CabShape | 'joint';
/** How far a cab's own colour reaches into the car, in pixels. */
const CAB_PAINT: Record<CabShape, number> = { round: 9, sloped: 13, flat: 11, cabin: 0 };
/**
 * Traces one end of a car from one side to the other: a rounded metro front, Euskotren's tapered
 * nose, an upright cab, or a plain gangway end. `dir` is 1 at the front, -1 at the rear.
 */
function traceEnd(ctx: CanvasRenderingContext2D, shape: End, left: number, right: number, edge: number, dir: number, bus: boolean) {
  const at = (u: number) => left + (right - left) * u, y = (v: number) => edge + dir * v, width = Math.abs(right - left);
  if (shape === 'sloped' && !bus) {
    ctx.lineTo(at(0), y(12)); ctx.quadraticCurveTo(at(0), y(2), at(.22), y(0)); ctx.lineTo(at(.78), y(0)); ctx.quadraticCurveTo(at(1), y(2), at(1), y(12));
    return;
  }
  const r = bus ? 6 : shape === 'joint' ? 2 : shape === 'round' ? width * .42 : shape === 'cabin' ? 5 : 4;
  ctx.lineTo(at(0), y(r)); ctx.quadraticCurveTo(at(0), y(0), at(r / width), y(0)); ctx.lineTo(at(1 - r / width), y(0)); ctx.quadraticCurveTo(at(1), y(0), at(1), y(r));
}
function outline(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, length: number, front: End, rear: End, bus: boolean) {
  ctx.beginPath(); ctx.moveTo(x, y + length / 2);
  traceEnd(ctx, front, x, x + width, y, 1, bus); traceEnd(ctx, rear, x + width, x, y + length, -1, bus);
  ctx.closePath();
}
/** Top view, front up (the layer rotates it to the bearing): white halo, body, side bands, a cab at each end of a train, doors, roof equipment. */
function drawVehicleIcon(kind: ReturnType<typeof vehicleKind>, consist: { count: number; length: number }, { body, accent, front: cab, band = 'thin' }: VehicleLivery, shape: VehicleBody) {
  const { count } = consist, { carLength, width, gap, height } = iconGeometry(kind, consist);
  const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = height;
  const ctx = canvas.getContext('2d')!, x = (48 - width) / 2, bus = kind === 'bus', tram = kind === 'tram', funicular = kind === 'funicular';
  for (let car = 0; car < count; car++) {
    const y = 3 + car * (carLength + gap), first = car === 0, last = car === count - 1;
    const frontCab = first && !bus, rearCab = last && !bus;
    const frontEnd: End = first ? shape.cab : 'joint', rearEnd: End = rearCab ? shape.cab : last ? 'flat' : 'joint';
    outline(ctx, x - 2, y - 2, width + 4, carLength + 4, frontEnd, rearEnd, bus); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
    outline(ctx, x, y, width, carLength, frontEnd, rearEnd, bus);
    ctx.save(); ctx.clip();
    ctx.fillStyle = body; ctx.fillRect(x, y, width, carLength);
    // Side bands in the livery's secondary colour (wider for a band over the lower half).
    const stripe = band === 'broad' ? 4.5 : band === 'skirt' ? 2.5 : 2;
    ctx.fillStyle = accent; ctx.fillRect(x, y + 3, stripe + 1.2, carLength - 6); ctx.fillRect(x + width - 1.2 - stripe, y + 3, stripe + 1.2, carLength - 6);
    // Trains have a cab at each end, in the livery's front colour.
    const paint = bus ? 0 : CAB_PAINT[shape.cab];
    if (cab && paint) { ctx.fillStyle = cab; if (frontCab) ctx.fillRect(x, y, width, paint); if (rearCab) ctx.fillRect(x, y + carLength - paint, width, paint); }
    const roofFrom = y + (first ? Math.max(paint, 10) + 2 : 4), roofTo = y + carLength - (rearCab ? Math.max(paint, 8) + 2 : bus && last ? 9 : 4);
    ctx.fillStyle = shade(body, .18); ctx.beginPath(); ctx.roundRect(x + 6, roofFrom, width - 12, Math.max(2, roofTo - roofFrom), 3); ctx.fill();
    // Windscreens: a raked nose shows a long one from above; a funicular is glazed at both ends.
    ctx.fillStyle = '#1d313b';
    const screen = shape.cab === 'sloped' && !bus ? 9 : funicular ? 8 : 7;
    if (first) { ctx.beginPath(); ctx.roundRect(x + 3.5, y + 3, width - 7, screen, [4, 4, 1.5, 1.5]); ctx.fill(); }
    if (rearCab) { ctx.beginPath(); ctx.roundRect(x + 3.5, y + carLength - 3 - screen, width - 7, screen, [1.5, 1.5, 4, 4]); ctx.fill(); }
    if (last && bus) ctx.fillRect(x + 5, y + carLength - 5, width - 10, 3);
    // Doors, as notches in the sides, spread over the saloon.
    if (!bus) {
      const from = y + (frontCab ? paint + 6 : 4), to = y + carLength - (rearCab ? paint + 6 : 4);
      ctx.fillStyle = shade(body, -.45);
      for (let door = 0; door < shape.doors; door++) {
        const at = from + (door + .5) * (to - from) / shape.doors;
        ctx.fillRect(x, at - 2, 1.8, 4); ctx.fillRect(x + width - 1.8, at - 2, 1.8, 4);
      }
    }
    // Roof equipment: air-conditioning on trains, a tram's long fairing, a bus's unit.
    ctx.fillStyle = shade(body, -.2);
    if (tram) ctx.fillRect(x + width / 2 - 4, y + carLength * .25, 8, carLength * .5);
    else if (bus) ctx.fillRect(x + width / 2 - 4, y + carLength / 2 - 3, 8, 6);
    else if (!funicular) for (const at of [.3, .7]) ctx.fillRect(x + width / 2 - 4, y + carLength * at - 2.5, 8, 5);
    // Pantographs: over the inner end of each cab car on trains, on the middle module of a tram.
    const pantograph = tram ? (count > 1 && car === Math.floor(count / 2) ? y + carLength / 2 : null) : funicular || bus || count === 1 ? null : first ? y + carLength - 8 : last ? y + 8 : null;
    if (pantograph !== null) {
      const middle = x + width / 2;
      ctx.strokeStyle = '#33424a'; ctx.lineWidth = 1.4; ctx.beginPath();
      ctx.moveTo(middle - 6, pantograph); ctx.lineTo(middle, pantograph - 4); ctx.lineTo(middle + 6, pantograph); ctx.lineTo(middle, pantograph + 4); ctx.closePath();
      ctx.moveTo(x + 5, pantograph - 4); ctx.lineTo(x + width - 5, pantograph - 4); ctx.stroke();
    }
    ctx.restore();
    outline(ctx, x, y, width, carLength, frontEnd, rearEnd, bus); ctx.lineWidth = 1.5; ctx.strokeStyle = shade(body, -.35); ctx.stroke();
    if (!last) { ctx.fillStyle = '#38434a'; ctx.fillRect(x + (tram ? 4 : 7), y + carLength, width - (tram ? 8 : 14), gap); }
  }
  return ctx.getImageData(0, 0, 48, height);
}
/** Images for every kind/consist/livery among these routes or vehicles (a vehicle may differ from its route, e.g. a five-car metro). */
export function installVehicleIcons(map: Map, items: readonly IconVehicle[]) {
  for (const route of items) {
    const id = vehicleIconId(route); if (map.hasImage(id)) continue;
    const livery = liveryFor(route);
    map.addImage(id, drawVehicleIcon(vehicleKind(route), compositionFor(route), livery, bodyFor(route)), { pixelRatio: 1 });
  }
}
