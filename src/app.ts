import { Map as TransitMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { loadNetwork, loadSnapshot, loadShapes, loadLine, loadStop, loadTrip } from './transit/client';
import type { Network, Snapshot, Route, Stop, Vehicle, LineDetail, StopDetail, TripDetail, TransitMode } from './transit/networkTypes';
import { searchNetwork, type SearchResult } from './transit/search';
import { positionQuality } from './transit/motion';
import { TransitRenderer } from './map/transitRenderer';
import { empty, styleUrl, setData, installLayers, installVehicleIcons, stopsData, routeData, fitShapes } from './map/networkMap';
import { shell, esc, badge, quality, eta, time, departures, positionExplanation, delayLabel } from './ui';
import { setupPwa } from './pwa';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
$('#app').innerHTML = shell;
setupPwa();
const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private browsing can deny persistence. */ } };
let favorites = new Set<string>();
try { const saved = JSON.parse(read('transit:favorites', '[]')); if (Array.isArray(saved)) favorites = new Set(saved.filter((s) => typeof s === 'string')); } catch { /* Recover malformed storage. */ }
let theme = read('transit:theme', 'system');
if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
const media = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => theme === 'dark' || (theme === 'system' && media.matches);
document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
$<HTMLSelectElement>('#theme').value = theme;
setWorkerUrl(workerUrl);
const map = new TransitMap({ container: 'map', style: styleUrl(isDark()), center: [-2.949, 43.277], zoom: 12.45, pitch: 0, attributionControl: { compact: true }, maxPitch: 65 });
const renderer = new TransitRenderer(map);
let network: Network | null = null, snapshot: Snapshot | null = null;
let mode: TransitMode | 'all' = 'all';
let selection: { kind: 'vehicle'; id: string } | { kind: 'route'; route: Route; direction: string } | { kind: 'stop'; stop: Stop } | null = null;
let detail: LineDetail | StopDetail | TripDetail | null = null, detailVersion = 0, detailError = '';
let following = false, lastFollow = 0, polling = false, toastTimer = 0;
let results: SearchResult[] = [], resultIndex = -1;
const inFlightShapes = new Set<string>();
const operatorName = (id: string) => network?.operators.find((o) => o.id === id)?.name ?? id;
const selectedVehicle = () => { const current = selection; return current?.kind === 'vehicle' ? snapshot?.vehicles.find((v) => v.id === current.id) : undefined; };
const padding = () => innerWidth < 700 ? { top: 130, bottom: selection ? Math.min(innerHeight * .43, 340) : 120, left: 35, right: 35 } : { top: 150, bottom: 70, left: selection ? 410 : 70, right: 80 };
function toast(message: string) { $('#toast').textContent = message; $('#toast').hidden = false; window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('#toast').hidden = true, 6000); }
function filters() {
  renderer.mode = mode;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  if (map.getLayer('stations')) {
    const enabled = ['any', ...[...renderer.operators].map((id) => ['all', ['==', ['get', 'operator'], id], ['any', ...['bus', 'rail', 'tram', 'funicular', 'unknown'].filter((m) => !renderer.disabledLayers.has(id + ':' + m)).map((m) => ['in', m, ['get', 'modes']])]])];
    const transport = mode === 'all' ? true : ['in', mode, ['get', 'modes']];
    map.setFilter('stations', ['all', ['==', ['get', 'station'], true], enabled, transport] as never);
    map.setFilter('bus-stops', ['all', ['==', ['get', 'station'], false], enabled, transport] as never);
    map.setFilter('stop-labels', ['all', enabled, transport] as never);
  }
  updateStatus(); void ensureShapes();
}
function updateStatus() {
  const count = renderer.getVehicles().length;
  const age = snapshot ? Date.now() + renderer.clockOffset - snapshot.fetchedAt : 0;
  const stale = !!snapshot && age > 45_000;
  $('.map-status').classList.toggle('stale', stale || !navigator.onLine);
  $('#status').textContent = !navigator.onLine ? 'Sin conexión · última actualización disponible' : !snapshot ? 'Cargando la red de transporte…' : stale ? 'Esperando datos recientes…' : `${count} vehículos · ${renderer.getVehicles().filter((v) => positionQuality(v, Date.now() + renderer.clockOffset) === 'live').length} con GPS reciente`;
  $('#empty-map').hidden = !snapshot || count > 0;
  $('#empty-map').textContent = renderer.operators.size === 0 ? 'Activa un operador en Capas para ver la red.' : 'No hay vehículos activos con estos filtros. Puedes explorar las paradas.';
  renderOperators();
}
function renderOperators() {
  if (!network) return;
  const openGroups = new Set([...document.querySelectorAll<HTMLDetailsElement>('[data-provider-group][open]')].map((d) => d.dataset.providerGroup));
  const row = (id: string, name?: string, transport?: TransitMode) => {
    const o = network!.operators.find((o) => o.id === id); if (!o) return '';
    const provider = snapshot?.providers.find((p) => p.operatorId === id), state = provider?.status ?? o.status;
    const vehicles = snapshot?.vehicles.filter((v) => v.operatorId === id && (!transport || v.mode === transport)) ?? [];
    const gps = vehicles.some((v) => v.observationTimestamp !== null), timings = (provider?.realtimeTripCount ?? 0) > 0;
    const label = state === 'unavailable' ? 'Fuente no disponible' : gps && timings ? 'GPS + llegadas realtime' : timings ? 'Llegadas realtime · posición estimada' : gps ? id === 'bilbobus' ? 'GPS · llegadas por parada' : 'GPS + horarios' : 'Según horario';
    const checked = renderer.operators.has(id) && (!transport || !renderer.disabledLayers.has(id + ':' + transport));
    return '<label class="operator-row"><input type="checkbox" data-operator="' + esc(id) + '" ' + (transport ? 'data-transport="' + transport + '" ' : '') + (checked ? 'checked' : '') + '><span class="operator-dot" style="background:' + esc(o.color) + '"></span><span><strong>' + esc(name ?? o.name) + '</strong><small>' + label + '</small></span><span class="operator-count">' + vehicles.length + '</span></label>';
  };
  const primary = new Set(['metro-bilbao', 'euskotren', 'renfe', 'bizkaibus', 'bilbobus', 'funicular-artxanda']);
  const groups = new Map<string, string[]>();
  network.operators.filter((o) => !primary.has(o.id)).forEach((o) => { const group = o.group ?? 'Otros'; if (!groups.has(group)) groups.set(group, []); groups.get(group)!.push(row(o.id)); });
  $('#operator-list').innerHTML = row('metro-bilbao') + row('euskotren', 'Euskotren · tren', 'rail') + row('euskotren', 'Tranvía · Bilbao / Vitoria', 'tram') + row('renfe') + row('bizkaibus') + row('bilbobus') + row('funicular-artxanda') + [...groups].map(([name, rows]) => '<details data-provider-group="' + esc(name) + '" ' + (openGroups.has(name) ? 'open' : '') + '><summary>' + esc(name) + ' · ' + rows.length + ' operadores</summary>' + rows.join('') + '</details>').join('');

}
async function ensureShapes() {
  const keys = [...new Set(renderer.getVehicles().filter((v) => map.getBounds().contains([v.longitude, v.latitude]) || v.id === renderer.selectedId).map((v) => v.shapeKey))].filter((k) => !renderer.shapes.has(k) && !inFlightShapes.has(k));
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50); batch.forEach((k) => inFlightShapes.add(k));
    try { (await loadShapes(batch)).forEach((s) => renderer.shapes.set(s.key, s)); }
    catch { /* Keep snapshot coordinates; retry geometry on the next poll. */ }
    finally { batch.forEach((k) => inFlightShapes.delete(k)); }
  }
}
async function refresh() {
  if (polling || !navigator.onLine) return;
  polling = true; $('#refresh').textContent = 'Actualizando…';
  try {
    if (!network) { network = await loadNetwork(); network.operators.forEach((o) => renderer.operators.add(o.id)); setData(map, 'stops', stopsData(network.stops)); installVehicleIcons(map, network); }
    snapshot = await loadSnapshot(); renderer.update(snapshot.vehicles, snapshot.fetchedAt, snapshot.serverTime); filters(); renderDetails();
  } catch (error) { toast(error instanceof Error ? error.message : 'No se pudieron cargar los datos.'); $('#status').textContent = snapshot ? 'Actualización no disponible · datos anteriores' : 'Datos no disponibles · reintenta desde Capas'; }
  finally { polling = false; $('#refresh').textContent = '↻ Actualizar datos'; }
}
function search() {
  if (!network) { $('#results').innerHTML = '<p class="empty-copy">La red se está cargando…</p>'; return; }
  const query = $<HTMLInputElement>('#search').value;
  if (query.trim()) results = searchNetwork(network, query, mode, renderer.operators, renderer.disabledLayers);
  else { results = [...network.routes.filter((r) => favorites.has(`route:${r.key}`)).map((item): SearchResult => ({ type: 'route', item })), ...network.stops.filter((s) => favorites.has(`stop:${s.key}`)).map((item): SearchResult => ({ type: 'stop', item }))]; if (!results.length) results = network.places.map((item) => ({ type: 'place', item })); }
  resultIndex = -1;
  $('.search-heading').textContent = query ? `${results.length} resultados` : favorites.size ? 'Tus favoritos' : 'Explora Bilbao y Bizkaia';
  $('#results').innerHTML = results.map((r, i) => `<button id="result-${i}" class="search-result row" role="option" aria-selected="false" data-result="${i}">${r.type === 'route' ? badge(r.item) : `<span class="result-icon">${r.type === 'stop' ? '◎' : '⌖'}</span>`}<span class="row-copy"><strong>${esc(r.type === 'route' ? r.item.longName || r.item.shortName : r.item.name)}</strong><small>${r.type === 'place' ? 'Lugar de la red' : `${r.type === 'route' ? 'Línea' : 'Parada / estación'} · ${esc(operatorName(r.item.operatorId))}`}</small></span><span>↗</span></button>`).join('') || '<p class="empty-copy">No encontramos coincidencias. Prueba una línea o el nombre de una estación.</p>';
  $('#search-results').hidden = false; $('#search').setAttribute('aria-expanded', 'true'); $('#clear-search').hidden = !query;
}
function closeSearch() { $('#search-results').hidden = true; $('#search').setAttribute('aria-expanded', 'false'); $('#search').removeAttribute('aria-activedescendant'); }
function chooseResult(index: number) { const result = results[index]; if (!result) return; closeSearch(); $('#search').blur(); if (result.type === 'route') void selectRoute(result.item); else if (result.type === 'stop') void selectStop(result.item); else { closeDetails(); map.easeTo({ center: [result.item.longitude, result.item.latitude], zoom: 15, duration: 850 }); } }
function openPanel() { $('#details').hidden = false; $('#details').classList.remove('collapsed'); closeSearch(); $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); detailError = ''; }
function favoriteKey() { return selection?.kind === 'route' ? `route:${selection.route.key}` : selection?.kind === 'stop' ? `stop:${selection.stop.key}` : null; }
function closeDetails() { selection = null; detail = null; detailVersion++; following = false; renderer.focusRoute = null; renderer.selectedId = null; renderer.direction = 'all'; $('#details').hidden = true; $('#debug').hidden = true; map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 }); setData(map, 'selected-route', empty); setData(map, 'selected-stops', empty); }
async function selectRoute(route: Route, direction = 'all', fit = true) {
  renderer.operators.add(route.operatorId); renderer.disabledLayers.delete(route.operatorId + ':' + route.mode); if (mode !== 'all' && mode !== route.mode) mode = route.mode; filters();
  selection = { kind: 'route', route, direction }; detail = null; following = false; renderer.selectedId = null; renderer.focusRoute = route.key; renderer.direction = direction; openPanel(); renderDetails();
  setData(map, 'selected-route', empty); setData(map, 'selected-stops', empty); $('#detail-content').scrollTop = 0;
  const version = ++detailVersion;
  try { const result = await loadLine(route, direction); if (version !== detailVersion) return; detail = result; result.shapes.forEach((s) => renderer.shapes.set(s.key, s)); setData(map, 'selected-route', routeData(result.shapes, route.color)); setData(map, 'selected-stops', stopsData(result.stops)); if (fit) fitShapes(map, result.shapes, padding()); renderDetails(); }
  catch (error) { if (version === detailVersion) { detailError = String((error as Error).message); renderDetails(); } }
}
async function selectStop(stop: Stop) {
  selection = { kind: 'stop', stop }; detail = null; following = false; renderer.selectedId = null; renderer.focusRoute = null; openPanel(); setData(map, 'selected-route', empty); setData(map, 'selected-stops', stopsData([stop])); map.easeTo({ center: [stop.longitude, stop.latitude], zoom: Math.max(map.getZoom(), 15), padding: padding(), duration: 700 }); renderDetails();
  $('#detail-content').scrollTop = 0; const version = ++detailVersion;
  try { const result = await loadStop(stop); if (version !== detailVersion) return; detail = result; setData(map, 'selected-stops', stopsData(result.nearbyStops)); renderDetails(); }
  catch (error) { if (version === detailVersion) { detailError = (error as Error).message; renderDetails(); } }
}
async function selectVehicle(vehicle: Vehicle) {
  renderer.operators.add(vehicle.operatorId); renderer.disabledLayers.delete(vehicle.operatorId + ':' + vehicle.mode); if (mode !== 'all' && mode !== vehicle.mode) mode = vehicle.mode; filters();
  selection = { kind: 'vehicle', id: vehicle.id }; detail = null; following = false; renderer.selectedId = vehicle.id; renderer.focusRoute = vehicle.routeKey; renderer.direction = 'all'; openPanel(); renderDetails();
  const coordinate = renderer.coordinate(vehicle.id); if (coordinate) map.easeTo({ center: coordinate, zoom: Math.max(map.getZoom(), 14.5), padding: padding(), duration: 700 });
  setData(map, 'selected-route', empty); setData(map, 'selected-stops', empty); $('#detail-content').scrollTop = 0;
  const version = ++detailVersion;
  try { const result = await loadTrip(vehicle); if (version !== detailVersion) return; detail = result; if (result.shape) { renderer.shapes.set(result.shape.key, result.shape); setData(map, 'selected-route', routeData([result.shape], vehicle.color)); } setData(map, 'selected-stops', stopsData(result.stops)); renderDetails(); }
  catch (error) { if (version === detailVersion) { detailError = (error as Error).message; renderDetails(); } }
}
function renderDetails() {
  if (!selection) return;
  const key = favoriteKey(); $('#favorite').hidden = !key; $('#favorite').textContent = key && favorites.has(key) ? '★' : '☆'; $('#favorite').setAttribute('aria-pressed', String(!!key && favorites.has(key)));
  $('#back').hidden = selection.kind !== 'vehicle';
  const loading = detailError ? `<div class="detail-error">${esc(detailError)}<button class="text-button" data-retry>Reintentar</button></div>` : '<p class="loading-copy">Consultando servicios…</p>';
  if (selection.kind === 'vehicle') {
    const v = selectedVehicle();
    if (!v) { $('#detail-content').innerHTML = '<div class="detail-heading"><h1>Servicio finalizado</h1><p>Este vehículo ya no aparece entre los servicios activos.</p></div>'; return; }
    const q = positionQuality(v, Date.now() + renderer.clockOffset), trip = detail as TripDetail | null;
    const delay = v.delaySeconds;
    const next = trip?.stops.find((s) => s.progress > v.progressMetersAlongShape + 10);
    $('#detail-content').innerHTML = `<div class="detail-heading"><div class="eyebrow">${esc(v.operatorName)} · ${v.mode === 'rail' ? 'Metro / tren' : v.mode === 'tram' ? 'Tranvía' : v.mode === 'funicular' ? 'Funicular' : 'Bus'}</div><div class="title-row">${badge(v)}<h1>${esc(v.headsign || 'Servicio en circulación')}</h1></div>${quality(q, renderer.dataQuality(v.id))}<p class="quality-explanation">${esc(positionExplanation(v, Date.now() + renderer.clockOffset))}</p></div><div class="next-stop"><span>Próxima parada</span><strong>${esc(v.nextStop?.name ?? next?.name ?? 'Fin del recorrido')}</strong><div>${next?.realtime ? eta(next.at) : v.nextStop ? eta(v.nextStop.at) : next ? eta(next.at) : '—'}${delay !== null ? `<small> · ${v.delayEstimated ? 'Desfase estimado · ' : ''}${delayLabel(delay)}</small>` : ''}</div></div><div class="detail-actions"><button data-follow class="${following ? 'primary' : ''}">${following ? '● Siguiendo' : '⌖ Seguir vehículo'}</button><button data-fit>Ver recorrido</button></div><section class="detail-section"><div class="section-heading"><h2>Paradas del recorrido</h2><button data-full-line class="text-button">Ver línea →</button></div>${trip ? stopRows(trip.stops, v.progressMetersAlongShape) : loading}</section>`;
    if (new URLSearchParams(location.search).has('debug')) { $('#debug').hidden = false; $('#debug').textContent = `trip: ${v.tripId}\nshape: ${v.shapeKey}\nprogress: ${v.progressMetersAlongShape.toFixed(1)} m\nrendered coordinate: ${renderer.coordinate(v.id)?.map(n => n.toFixed(6)).join(", ")}\nquality: ${q}\nGPS: ${v.observationTimestamp ? new Date(v.observationTimestamp).toISOString() : 'none'}\nlast query: ${snapshot ? new Date(snapshot.fetchedAt).toISOString() : 'none'}\nrender frame: ${new Date().toISOString()}\nmotion time: ${new Date(renderer.renderedTimestamp(v.id)).toISOString()}\nrendered: ${renderer.renderedVehicles} / ${renderer.getVehicles().length}\nframe: ${renderer.renderMilliseconds.toFixed(2)} ms\nspeed: ${v.speedMetersPerSecond?.toFixed(1) ?? 'unknown'} m/s\nshape cache: ${renderer.shapes.size}\n${following ? 'following' : ''}`; }
    if (new URLSearchParams(location.search).has('debug')) $('#debug').textContent += `\nLOD: ${renderer.lod}\n3D vehicles/cars: ${renderer.modelVehicles}/${renderer.modelCars}\nmotion: ${JSON.stringify(renderer.diagnostics(v.id), null, 2)}`;
  } else if (selection.kind === 'route') {
    const route = selection.route, line = detail as LineDetail | null;
    const active = renderer.getVehicles().filter((v) => v.routeKey === route.key && (selection?.kind !== 'route' || selection.direction === 'all' || String(v.directionId ?? 'unknown') === selection.direction));
    $('#detail-content').innerHTML = `<div class="detail-heading"><div class="eyebrow">${esc(operatorName(route.operatorId))}</div><div class="title-row">${badge(route)}<h1>${esc(route.longName || route.shortName)}</h1></div><p>${active.length} vehículos activos</p></div><div class="direction-control"><label for="direction">Sentido</label><select id="direction"><option value="all">Todos los sentidos</option>${route.directions.map((d) => `<option value="${esc(d.id)}" ${selection?.kind === 'route' && selection.direction === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div><section class="detail-section"><h2>Ahora en circulación</h2>${active.length ? active.slice(0, 12).map((v) => `<button class="row vehicle-row" data-vehicle="${esc(v.id)}"><span class="result-icon">↗</span><span class="row-copy"><strong>${esc(v.headsign || route.longName)}</strong><small>${esc(v.nextStop?.name ?? 'En recorrido')}</small></span>${quality(positionQuality(v, Date.now() + renderer.clockOffset), renderer.dataQuality(v.id))}</button>`).join('') : '<p class="empty-copy">No hay vehículos activos con este sentido y estos filtros.</p>'}</section><section class="detail-section"><h2>Próximas salidas desde cabecera</h2>${line ? departures(line.departures, operatorName) : loading}</section><section class="detail-section"><h2>Paradas ${selection.direction === 'all' ? '· recorrido de referencia' : ''}</h2>${line ? stopRows(line.stops) : ''}</section>`;
  } else {
    const stop = selection.stop, data = detail as StopDetail | null;
    $('#detail-content').innerHTML = `<div class="detail-heading"><div class="eyebrow">Parada / estación</div><h1>${esc(stop.name)}</h1><p>${data ? [...new Set(data.nearbyStops.map((s) => operatorName(s.operatorId)))].map(esc).join(' · ') : esc(operatorName(stop.operatorId))}</p></div><section class="detail-section"><div class="section-heading"><h2>Próximos servicios</h2><small>Hora local</small></div>${data ? departures(data.departures, operatorName) : loading}<p class="section-note">Incluye paradas a menos de 80 m. Las llegadas marcadas como horario pueden variar.</p></section>`;
  }
}
function stopRows(stops: (Stop & { at?: number; progress?: number; skipped?: boolean; realtime?: boolean })[], progress = -1) {
  return `<ol class="stop-timeline">${stops.map((s) => `<li class="${s.progress !== undefined && s.progress < progress - 10 ? 'passed' : ''}"><button data-stop="${esc(s.key)}"><span>${esc(s.name)}</span>${s.skipped ? '<small>No para</small>' : s.at ? `<small>${s.realtime ? '↻ ' : ''}${time(s.at)}</small>` : ''}</button></li>`).join('')}</ol>`;
}
function drawSelection() {
  if (!detail || !selection) return;
  if (selection.kind === 'route') { const d = detail as LineDetail; setData(map, 'selected-route', routeData(d.shapes, selection.route.color)); setData(map, 'selected-stops', stopsData(d.stops)); }
  if (selection.kind === 'stop') setData(map, 'selected-stops', stopsData((detail as StopDetail).nearbyStops));
  if (selection.kind === 'vehicle') { const d = detail as TripDetail, v = selectedVehicle(); if (d.shape && v) setData(map, 'selected-route', routeData([d.shape], v.color)); setData(map, 'selected-stops', stopsData(d.stops)); }
}
map.on('style.load', () => { installLayers(map, network, isDark()); filters(); drawSelection(); });
map.on('error', (event) => { if (event.error.message.includes('WebGL')) toast('El mapa necesita un navegador con WebGL activado.'); });
map.on('click', async (event) => {
  const layers = ['vehicle-dot', 'clusters', 'selected-stops-dot', 'stations', 'bus-stops'].filter((l) => map.getLayer(l)); if (!layers.length) return;
  const feature = map.queryRenderedFeatures(event.point, { layers })[0];
  if (!feature) { closeSearch(); return; }
  if (feature.properties?.cluster_id !== undefined) { const source = map.getSource('vehicles') as import('maplibre-gl').GeoJSONSource; const zoom = await source.getClusterExpansionZoom(Number(feature.properties.cluster_id)); if (feature.geometry.type === 'Point') map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom }); }
  else if (feature.properties?.id) { const v = snapshot?.vehicles.find((v) => v.id === feature.properties.id); if (v) void selectVehicle(v); }
  else if (feature.properties?.key) { const s = network?.stops.find((s) => s.key === feature.properties.key); if (s) void selectStop(s); }
});
map.on('mousemove', (event) => { const layers = ['vehicle-dot', 'clusters', 'stations', 'bus-stops', 'selected-stops-dot'].filter((l) => map.getLayer(l)); if (layers.length) map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers }).length ? 'pointer' : ''; });
map.on('dragstart', (event) => { if (event.originalEvent && following) { following = false; renderDetails(); } });
renderer.onSelectedPosition = (coordinate) => { if (following && Date.now() - lastFollow > 700) { lastFollow = Date.now(); map.easeTo({ center: coordinate, duration: 750, padding: padding() }); } };
renderer.start();
$<HTMLInputElement>('#search').addEventListener('input', search);
$('#search').addEventListener('focus', search);
$('#search').addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!results.length) return; resultIndex = (resultIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; document.querySelectorAll('[data-result]').forEach((r, i) => { r.classList.toggle('highlight', i === resultIndex); r.setAttribute('aria-selected', String(i === resultIndex)); }); $('#search').setAttribute('aria-activedescendant', `result-${resultIndex}`); $(`#result-${resultIndex}`).scrollIntoView({ block: 'nearest' }); } if (event.key === 'Enter') { event.preventDefault(); chooseResult(Math.max(0, resultIndex)); } });
$('#clear-search').onclick = () => { $<HTMLInputElement>('#search').value = ''; search(); $('#search').focus(); };
$('#results').onclick = (event) => { const item = (event.target as HTMLElement).closest<HTMLElement>('[data-result]'); if (item) chooseResult(Number(item.dataset.result)); };
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.onclick = () => { mode = button.dataset.mode as typeof mode; filters(); if (!$('#search-results').hidden) search(); renderDetails(); });
$('#layers-button').onclick = () => { $('#layers').hidden = !$('#layers').hidden; $('#layers-button').setAttribute('aria-expanded', String(!$('#layers').hidden)); closeSearch(); };
$('[data-close-layers]').onclick = () => { $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); };
$('#operator-list').addEventListener('change', (event) => { const input = event.target as HTMLInputElement; if (input.dataset.operator) { if (input.dataset.transport) { const key = input.dataset.operator + ':' + input.dataset.transport; renderer.operators.add(input.dataset.operator); if (input.checked) renderer.disabledLayers.delete(key); else renderer.disabledLayers.add(key); } else if (input.checked) renderer.operators.add(input.dataset.operator); else renderer.operators.delete(input.dataset.operator); filters(); renderDetails(); } });
function changeTheme() { document.documentElement.dataset.theme = isDark() ? 'dark' : 'light'; map.setStyle(styleUrl(isDark())); }
$('#theme').addEventListener('change', () => { theme = $<HTMLSelectElement>('#theme').value; write('transit:theme', theme); changeTheme(); });
media.addEventListener('change', () => { if (theme === 'system') changeTheme(); });
$('#underground').onchange = () => { renderer.showUnderground = $<HTMLInputElement>('#underground').checked; };
map.on('moveend', () => { void ensureShapes(); });
$('#refresh').onclick = () => { void refresh(); };
$('#close-details').onclick = closeDetails;
$('#sheet-handle').onclick = () => $('#details').classList.toggle('collapsed');
let touchY = 0; $('#sheet-handle').addEventListener('touchstart', (event) => touchY = event.touches[0].clientY, { passive: true });
$('#sheet-handle').addEventListener('touchend', (event) => { const delta = event.changedTouches[0].clientY - touchY; if (Math.abs(delta) > 30) $('#details').classList.toggle('collapsed', delta > 0); }, { passive: true });
$('#favorite').onclick = () => { const key = favoriteKey(); if (!key) return; if (favorites.has(key)) favorites.delete(key); else favorites.add(key); write('transit:favorites', JSON.stringify([...favorites])); renderDetails(); };
$('#back').onclick = () => { const v = selectedVehicle(), route = network?.routes.find((r) => r.key === v?.routeKey); if (route) void selectRoute(route, 'all', false); };
$('#detail-content').onclick = (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!target) return;
  if (target.dataset.stop) { const s = network?.stops.find((s) => s.key === target.dataset.stop); if (s) void selectStop(s); }
  if (target.dataset.route) { const r = network?.routes.find((r) => r.key === target.dataset.route); if (r) void selectRoute(r); }
  if (target.dataset.vehicle) { const v = snapshot?.vehicles.find((v) => v.id === target.dataset.vehicle); if (v) void selectVehicle(v); }
  if (target.hasAttribute('data-follow')) { following = !following; lastFollow = 0; renderDetails(); }
  if (target.hasAttribute('data-fit') && detail && 'shape' in detail && detail.shape) { following = false; fitShapes(map, [detail.shape], padding()); renderDetails(); }
  if (target.hasAttribute('data-full-line')) $('#back').click();
  if (target.hasAttribute('data-retry')) { if (selection?.kind === 'route') void selectRoute(selection.route, selection.direction, false); else if (selection?.kind === 'stop') void selectStop(selection.stop); else { const v = selectedVehicle(); if (v) void selectVehicle(v); } }
};
$('#detail-content').addEventListener('change', (event) => { const select = event.target as HTMLSelectElement; if (select.id === 'direction' && selection?.kind === 'route') void selectRoute(selection.route, select.value); });
$('#zoom-in').onclick = () => map.zoomIn(); $('#zoom-out').onclick = () => map.zoomOut(); $('#north').onclick = () => map.easeTo({ bearing: 0 });
$('#perspective').onclick = () => { const enabled = map.getPitch() < 20; map.easeTo({ pitch: enabled ? 50 : 0, duration: 650 }); $('#perspective').classList.toggle('active', enabled); $('#perspective').setAttribute('aria-pressed', String(enabled)); };
$('#locate').onclick = () => { if (!navigator.geolocation) { toast('Este navegador no ofrece ubicación.'); return; } navigator.geolocation.getCurrentPosition((p) => { const coordinates: [number, number] = [p.coords.longitude, p.coords.latitude]; setData(map, 'user-location', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } }] }); map.easeTo({ center: coordinates, zoom: 15, padding: padding() }); }, () => toast('No se pudo obtener tu ubicación. Comprueba los permisos del navegador.'), { timeout: 12000, maximumAge: 30000 }); };
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (!$('#search-results').hidden) closeSearch(); else if (!$('#layers').hidden) $('[data-close-layers]').click(); else closeDetails(); } if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); $('#search').focus(); } });
document.addEventListener('pointerdown', (event) => { const target = event.target as HTMLElement; if (!target.closest('.search-shell')) closeSearch(); if (!target.closest('#layers, #layers-button')) { $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
window.addEventListener('online', () => { void refresh(); }); window.addEventListener('offline', updateStatus);
window.setInterval(() => { if (!document.hidden) { void refresh(); } }, 15000);
window.setInterval(() => { if (!document.hidden) { updateStatus(); renderDetails(); } }, 10000);
window.setInterval(async () => { const current = selection, version = detailVersion; if (!current || document.hidden || !navigator.onLine) return; try { const vehicle = selectedVehicle(); const fresh = current.kind === 'stop' ? await loadStop(current.stop) : current.kind === 'route' ? await loadLine(current.route, current.direction) : vehicle ? await loadTrip(vehicle) : null; if (version === detailVersion && fresh) { detail = fresh; renderDetails(); } } catch { /* Keep previous detail; stale arrivals revert visibly to schedule. */ } }, 15000);
void refresh();
window.addEventListener('pagehide', () => renderer.stop());
window.addEventListener('pageshow', () => renderer.start());
