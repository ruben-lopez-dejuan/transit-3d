import { Map, LngLatBounds, type GeoJSONSource } from 'maplibre-gl';
import type { Network, Shape, Stop } from '../transit/networkTypes';
import { vehicleKind } from './vehicleLod';
import { compositionFor, liveryFor, type StyledVehicle } from '../../shared/transit/appearance';

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
  installVehicleIcons(map, network);
  map.addLayer({ id: 'selected-halo', type: 'circle', source: 'selected-vehicle', paint: { 'circle-radius': 8, 'circle-opacity': 0, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.2, 'circle-stroke-opacity': .6 } });
  map.addLayer({ id: 'vehicle-dot', type: 'circle', source: 'vehicles', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 12, 'circle-opacity': 0 } });
  map.addLayer({ id: 'vehicle-icon', type: 'symbol', source: 'vehicles', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, .25, 13, .38, 16, .52, 18, .7], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['case', ['get', 'underground'], .45, 1], 'icon-opacity-transition': { duration: 0, delay: 0 } } });
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
/** One image per kind, consist length and livery: the icon shows the real number of cars in the fleet's paint. */
export function vehicleIconId(vehicle: IconVehicle) {
  const livery = liveryFor(vehicle);
  const { count, length } = compositionFor(vehicle);
  return `${vehicleKind(vehicle)}-${count}x${length}-${livery.body}-${livery.accent}`;
}
const shade = (hex: string, amount: number) => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 + amount))));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};
/** Top view, front up (the layer rotates it to the bearing): white halo, body, side bands, glazing. */
function drawVehicleIcon(kind: ReturnType<typeof vehicleKind>, { count, length }: { count: number; length: number }, body: string, accent: string) {
  // Rail keeps its proportions; a bus is drawn larger than scale so it stays readable among trains.
  const pixelsPerMeter = kind === 'bus' ? 5.3 : kind === 'tram' ? 3.6 : 2.1;
  const carLength = Math.max(18, Math.round(length * pixelsPerMeter));
  const width = kind === 'bus' ? 26 : kind === 'tram' ? 24 : 27, gap = kind === 'tram' ? 2 : 4;
  const height = 6 + count * carLength + (count - 1) * gap;
  const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = height;
  const ctx = canvas.getContext('2d')!, x = (48 - width) / 2;
  for (let car = 0; car < count; car++) {
    const y = 3 + car * (carLength + gap), front = car === 0, rear = car === count - 1;
    const radius = kind === 'bus' ? 6 : kind === 'tram' ? 5 : 4;
    const corners = [front ? (kind === 'metro' ? radius : 9) : 2, front ? (kind === 'metro' ? radius : 9) : 2, rear ? radius : 2, rear ? radius : 2];
    ctx.beginPath(); ctx.roundRect(x - 2, y - 2, width + 4, carLength + 4, corners.map((c) => c + 2)); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(x, y, width, carLength, corners); ctx.fillStyle = body; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = shade(body, -.35); ctx.stroke();
    // Side bands in the livery's secondary colour, then the roof.
    ctx.fillStyle = accent; ctx.fillRect(x + 1.5, y + 4, 2.5, carLength - 8); ctx.fillRect(x + width - 4, y + 4, 2.5, carLength - 8);
    ctx.fillStyle = shade(body, .18); ctx.beginPath(); ctx.roundRect(x + 6, y + (front ? 13 : 5), width - 12, carLength - (front ? 18 : 10) - (rear && kind === 'bus' ? 6 : 0), 3); ctx.fill();
    ctx.fillStyle = '#1d313b';
    if (front) { ctx.beginPath(); ctx.roundRect(x + 3.5, y + 3, width - 7, 7, [4, 4, 1.5, 1.5]); ctx.fill(); }
    if (rear && kind === 'bus') { ctx.fillRect(x + 5, y + carLength - 5, width - 10, 3); }
    if (kind === 'bus' || kind === 'tram' || kind === 'funicular') { ctx.fillStyle = shade(body, -.25); ctx.fillRect(x + width / 2 - 4, y + carLength / 2 - 3, 8, 6); }
    if (!rear) { ctx.fillStyle = '#38434a'; ctx.fillRect(x + 7, y + carLength, width - 14, gap); }
  }
  return ctx.getImageData(0, 0, 48, height);
}
export function installVehicleIcons(map: Map, network: Network | null) {
  for (const route of network?.routes ?? []) {
    const id = vehicleIconId(route); if (map.hasImage(id)) continue;
    const livery = liveryFor(route);
    map.addImage(id, drawVehicleIcon(vehicleKind(route), compositionFor(route), livery.body, livery.accent), { pixelRatio: 1 });
  }
}
