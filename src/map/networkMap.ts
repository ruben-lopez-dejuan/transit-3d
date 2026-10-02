import { Map, LngLatBounds, type GeoJSONSource } from 'maplibre-gl';
import type { Network, Shape, Stop } from '../transit/networkTypes';

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
  map.addLayer({ id: 'clusters', type: 'circle', source: 'vehicles', filter: ['has', 'point_count'], paint: { 'circle-color': '#226b59', 'circle-radius': ['step', ['get', 'point_count'], 19, 20, 24, 100, 29], 'circle-stroke-color': white, 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'vehicles', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#ffffff' } });
  installVehicleIcons(map, network);
  map.addLayer({ id: 'selected-halo', type: 'circle', source: 'selected-vehicle', paint: { 'circle-radius': 19, 'circle-color': ['get', 'color'], 'circle-opacity': .13, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'vehicle-dot', type: 'circle', source: 'vehicles', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 12, 'circle-opacity': 0 } });
  map.addLayer({ id: 'vehicle-icon', type: 'symbol', source: 'vehicles', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['concat', ['case', ['==', ['get', 'mode'], 'bus'], 'bus-', 'rail-'], ['get', 'color']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, .25, 13, .38, 16, .52, 18, .7], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 15.8, ['case', ['get', 'underground'], .45, 1], 18, .1] } });
  map.addLayer({ id: 'vehicle-label', type: 'symbol', source: 'vehicles', minzoom: 12.5, filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['step', ['zoom'], ['get', 'label'], 14.5, ['concat', ['get', 'label'], ' · ', ['get', 'destination']], 16, ['concat', ['get', 'label'], ' · ', ['get', 'destination'], ['case', ['get', 'underground'], ' · túnel', '']]], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 2], 'text-anchor': 'top', 'text-max-width': 22, 'text-allow-overlap': false, 'symbol-sort-key': ['case', ['get', 'selected'], 0, 1] }, paint: { 'text-color': dark ? '#eff5f7' : '#243c3b', 'text-halo-color': white, 'text-halo-width': 2 } });
  map.addLayer({ id: 'location-halo', type: 'circle', source: 'user-location', paint: { 'circle-radius': 18, 'circle-color': '#3185e6', 'circle-opacity': .15 } });
  map.addLayer({ id: 'location-dot', type: 'circle', source: 'user-location', paint: { 'circle-radius': 6, 'circle-color': '#3185e6', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
}
export function fitShapes(map: Map, shapes: Shape[], padding: { top: number; bottom: number; left: number; right: number }) {
  map.resize();
  const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
  const x = Math.min(1, Math.max(0, width - 100) / (padding.left + padding.right));
  const y = Math.min(1, Math.max(0, height - 100) / (padding.top + padding.bottom));
  padding = { left: padding.left * x, right: padding.right * x, top: padding.top * y, bottom: padding.bottom * y };
  const bounds = new LngLatBounds(); shapes.forEach((s) => s.coordinates.forEach((c) => bounds.extend(c)));
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding, maxZoom: 15, duration: 850 });
}

export function installVehicleIcons(map: Map, network: Network | null) {
  for (const color of new Set(network?.routes.map((r) => r.color) ?? [])) for (const type of ['bus', 'rail']) {
    const id = type + '-' + color; if (map.hasImage(id)) continue;
    const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#17252d'; for (const x of [3, 36]) for (const y of [14, 55]) ctx.fillRect(x, y, 9, 12);
    ctx.fillStyle = color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(9, 3, 30, 74, type === 'bus' ? [9, 9, 4, 4] : 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#203b49'; ctx.beginPath(); ctx.roundRect(13, 10, 22, 13, 3); ctx.fill(); ctx.fillRect(12, 31, 4, 23); ctx.fillRect(32, 31, 4, 23);
    ctx.fillStyle = '#eef4f2'; ctx.fillRect(18, 30, 12, type === 'bus' ? 31 : 25);
    ctx.fillStyle = '#fff5c5'; ctx.fillRect(12, 5, 6, 3); ctx.fillRect(30, 5, 6, 3);
    ctx.fillStyle = '#e73939'; ctx.fillRect(12, 70, 5, 3); ctx.fillRect(31, 70, 5, 3);
    map.addImage(id, ctx.getImageData(0, 0, 48, 80), { pixelRatio: 1 });
  }
}
