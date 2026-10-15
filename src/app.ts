import { Map as TransitMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { loadCity, loadCities, loadNetwork, loadSnapshot, loadShapes, loadLine, loadStop, loadTrip } from './transit/client';
import { CITY_STORAGE_KEY, chooseCityId, cityUrl } from './transit/cities';
import type { Network, Snapshot, Route, Stop, Vehicle, LineDetail, StopDetail, TripDetail, TransitMode } from './transit/networkTypes';
import { searchNetwork, type SearchResult } from './transit/search';
import { nextStopAhead, positionQuality } from './transit/motion';
import { TransitRenderer } from './map/transitRenderer';
import { FollowCamera } from './map/followCamera';
import { empty, styleUrl, setData, installLayers, installVehicleIcons, stopsData, routeData, fitShapes } from './map/networkMap';
import { createShell, configureTimezone, esc, badge, reliabilityBadge, time, departures, positionExplanation, delayLabel, arrivalLabel, consistentArrival } from './ui';
import { arrivalReliability, RELIABILITY_LABELS, vehicleReliability } from '../shared/transit/reliability';
import { setupPwa } from './pwa';
import { icon, kindIcon } from './icons';
import { vehicleKind } from './map/vehicleLod';
import { migrateFavorites } from './transit/favorites';
import { readCityPreferences, writeCityPreferences } from './transit/preferences';
import { isZenShortcut, ZenLayers } from './map/zenMode';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const debugMode = location.pathname === '/debug' || location.pathname.startsWith('/debug/');
const DebugInspectorClass = debugMode ? (await import('./debugInspector')).DebugInspector : null;
$('#app').textContent = 'Cargando la red de transporte…';
const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private browsing can deny persistence. */ } };
const { city, cities } = await (async () => {
  const [cities, defaultCity] = await Promise.all([loadCities(), loadCity()]);
  const id = chooseCityId(cities, new URLSearchParams(location.search).get('city'), read(CITY_STORAGE_KEY, ''), defaultCity.id);
  // Loading the chosen city also sets the scope for every subsequent API request.
  const city = id === defaultCity.id ? defaultCity : await loadCity(id);
  return { city, cities };
})().catch((error) => { $('#app').textContent = error instanceof Error ? error.message : 'No se pudo cargar la ciudad.'; throw error; });
write(CITY_STORAGE_KEY, city.id);
history.replaceState(history.state, '', cityUrl(location.href, city.id));
document.title = city.presentation.title;
$('#app').innerHTML = createShell(city, cities);
const cityPreferences = readCityPreferences(city.id, localStorage);
configureTimezone(city.timezone);
setupPwa(city.presentation.title);
$<HTMLSelectElement>('#city-picker').addEventListener('change', (event) => {
  const id = (event.currentTarget as HTMLSelectElement).value;
  if (id === city.id || !cities.some((candidate) => candidate.id === id)) return;
  write(CITY_STORAGE_KEY, id);
  // A document navigation isolates pending responses, geometry, motion history and selections.
  location.assign(cityUrl(location.href, id));
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.hidden = button.dataset.mode !== 'all' && !city.modes.includes(button.dataset.mode as TransitMode);
let favorites = new Set<string>();
try { const saved = JSON.parse(read('transit:favorites', '[]')); if (Array.isArray(saved)) favorites = new Set(saved.filter((s) => typeof s === 'string')); } catch { /* Recover malformed storage. */ }
let theme = read('transit:theme', 'system');
if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
const media = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const duration = (milliseconds: number) => reducedMotion.matches ? 0 : milliseconds;
const isDark = () => theme === 'dark' || (theme === 'system' && media.matches);
document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
$<HTMLSelectElement>('#theme').value = theme;
setWorkerUrl(workerUrl);
const savedCamera = cityPreferences.camera;
const map = new TransitMap({ container: 'map', style: styleUrl(isDark()), center: savedCamera?.center ?? city.center, zoom: savedCamera?.zoom ?? city.presentation.initialZoom, bearing: savedCamera?.bearing ?? 0, pitch: savedCamera?.pitch ?? 0, attributionControl: { compact: true }, maxPitch: 65 });
// On a phone the credits start folded into their ⓘ button, which sits just above the tab bar.
// MapLibre unfolds them once the first source brings its attribution.
const foldAttribution = () => { const attribution = document.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show'); if (attribution) { attribution.classList.remove('maplibregl-compact-show'); map.off('sourcedata', foldAttribution); } };
if (innerWidth < 700) map.on('sourcedata', foldAttribution);
const renderer = new TransitRenderer(map);
renderer.showUnderground = cityPreferences.underground ?? true;
$<HTMLInputElement>('#underground').checked = renderer.showUnderground;
let network: Network | null = null, snapshot: Snapshot | null = null;
let mode: TransitMode | 'all' = cityPreferences.mode && (cityPreferences.mode === 'all' || city.modes.includes(cityPreferences.mode)) ? cityPreferences.mode : 'all';
let selection: { kind: 'vehicle'; id: string } | { kind: 'route'; route: Route; direction: string } | { kind: 'stop'; stop: Stop } | null = null;
let detail: LineDetail | StopDetail | TripDetail | null = null, detailVersion = 0, detailError = '';
let following = false, polling = false, toastTimer = 0, cameraSaveTimer = 0, sheetTimer = 0, nextNetworkRefreshAt = 0;
let results: SearchResult[] = [], resultIndex = -1;
let zen = false, zenWakeTimer = 0;
/** The vehicle whose card led to this line or stop, so the card can go back to it. */
let returnVehicle: string | null = null;
const zenLayers = new ZenLayers();
const inFlightShapes = new Set<string>();
let detailRequest: AbortController | null = null, operatorRenderKey = '';
const operatorName = (id: string) => network?.operators.find((o) => o.id === id)?.name ?? id;
const selectedVehicle = () => { const current = selection; return current?.kind === 'vehicle' ? snapshot?.vehicles.find((v) => v.id === current.id) : undefined; };
const debugInspector = DebugInspectorClass ? new DebugInspectorClass({ map, renderer, cityId: city.id, selectVehicle: (vehicle) => { void selectVehicle(vehicle); } }) : null;
const padding = () => {
  if (zen) return { top: 0, bottom: 0, left: 0, right: 0 };
  if (innerWidth >= 700) return { top: 150, bottom: 70, left: selection ? 410 : 70, right: 80 };
  const panel = $('#details');
  const covered = selection && !panel.hidden ? Math.max(0, innerHeight - panel.getBoundingClientRect().top) : 0;
  return { top: 125, bottom: Math.max(105, covered + 12), left: 24, right: 24 };
};
function persistCityPreferences() {
  const center = map.getCenter();
  writeCityPreferences(city.id, {
    mode,
    operators: network ? [...renderer.operators] : cityPreferences.operators,
    disabledLayers: network ? [...renderer.disabledLayers] : cityPreferences.disabledLayers,
    underground: renderer.showUnderground,
    camera: { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
  }, localStorage);
}
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
  const preparing = network?.operators.filter((operator) => operator.loading).length ?? 0;
  const available = network?.operators.filter((operator) => operator.status !== 'unavailable' && !operator.loading).length ?? 0;
  $('.map-status').classList.toggle('stale', stale || !navigator.onLine);
  const progress = preparing ? ` · ${available}/${network!.operators.length} fuentes listas` : '';
  const live = renderer.getVehicles().filter((v) => vehicleReliability(v, Date.now() + renderer.clockOffset).level === 'high').length;
  const ready = `${count} vehículos · ${live} en tiempo real${progress}`;
  $('#status').textContent = !navigator.onLine ? 'Sin conexión · última actualización disponible' : !snapshot ? 'Cargando la red de transporte…' : stale ? `Esperando datos recientes…${progress}` : ready;
  $('#empty-map').hidden = !snapshot || count > 0;
  $('#empty-map').textContent = renderer.operators.size === 0 ? 'Activa un operador en Capas para ver la red.' : 'No hay vehículos activos con estos filtros. Puedes explorar las paradas.';
  renderOperators();
}
function renderOperators() {
  if (!network) return;
  const counts = new Map<string, number>();
  const gpsSources = new Set<string>();
  for (const vehicle of snapshot?.vehicles ?? []) {
    counts.set(vehicle.operatorId, (counts.get(vehicle.operatorId) ?? 0) + 1);
    const layer = `${vehicle.operatorId}:${vehicle.mode}`;
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
    if (vehicle.observationTimestamp !== null) { gpsSources.add(vehicle.operatorId); gpsSources.add(layer); }
  }
  const providers = new Map((snapshot?.providers ?? []).map((provider) => [provider.operatorId, provider]));
  const key = JSON.stringify({
    operators: network.operators.map((operator) => [operator.id, operator.loading, operator.status, providers.get(operator.id)?.status, providers.get(operator.id)?.realtimeTripCount ?? 0, providers.get(operator.id)?.realtimeArrivalCount ?? 0, counts.get(operator.id) ?? 0]),
    gps: [...gpsSources].sort(),
    enabled: [...renderer.operators].sort(), disabled: [...renderer.disabledLayers].sort(),
  });
  if (key === operatorRenderKey) return;
  operatorRenderKey = key;
  const openGroups = new Set([...document.querySelectorAll<HTMLDetailsElement>('[data-provider-group][open]')].map((d) => d.dataset.providerGroup));
  const row = (id: string, name?: string, transport?: TransitMode) => {
    const o = network!.operators.find((o) => o.id === id); if (!o) return '';
    const provider = providers.get(id), state = provider?.status ?? o.status;
    const gps = gpsSources.has(transport ? `${id}:${transport}` : id), timings = (provider?.realtimeTripCount ?? 0) > 0 || (provider?.realtimeArrivalCount ?? 0) > 0;
    const label = o.loading ? 'Preparando datos…' : state === 'unavailable' ? 'Fuente no disponible' : gps && timings ? 'GPS y llegadas en tiempo real' : timings ? 'Llegadas en tiempo real · posición estimada' : gps ? o.capabilities.stopArrivals ? 'GPS · llegadas por parada' : 'GPS + horarios' : o.capabilities.scheduledService === false ? 'Sin predicciones recientes' : 'Según horario';
    const checked = renderer.operators.has(id) && (!transport || !renderer.disabledLayers.has(id + ':' + transport));
    return '<label class="operator-row"><input type="checkbox" data-operator="' + esc(id) + '" ' + (transport ? 'data-transport="' + transport + '" ' : '') + (checked ? 'checked' : '') + '><span class="operator-dot" style="background:' + esc(o.color) + '"></span><span><strong>' + esc(name ?? o.name) + '</strong><small>' + label + '</small></span><span class="operator-count">' + (counts.get(transport ? `${id}:${transport}` : id) ?? 0) + '</span></label>';
  };
  const rowsFor = (o: Network['operators'][number]) => o.layers?.map((layer) => row(o.id, layer.name, layer.mode)).join('') ?? row(o.id);
  const groups = new Map<string, string[]>();
  network.operators.filter((o) => !o.primary).forEach((o) => { const group = o.group ?? 'Otros'; if (!groups.has(group)) groups.set(group, []); groups.get(group)!.push(rowsFor(o)); });
  $('#operator-list').innerHTML = network.operators.filter((o) => o.primary).map(rowsFor).join('') + [...groups].map(([name, rows]) => '<details data-provider-group="' + esc(name) + '" ' + (openGroups.has(name) ? 'open' : '') + '><summary>' + esc(name) + ' · ' + rows.length + ' operadores</summary>' + rows.join('') + '</details>').join('');

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
    if (!network || Date.now() >= nextNetworkRefreshAt) {
      const firstLoad = !network;
      try {
        network = await loadNetwork(); favorites = migrateFavorites(favorites, network); write('transit:favorites', JSON.stringify([...favorites]));
        if (firstLoad) {
          const valid = new Set(network.operators.map((operator) => operator.id));
          const selected = cityPreferences.operators ?? [...valid];
          selected.filter((id) => valid.has(id)).forEach((id) => renderer.operators.add(id));
          for (const layer of cityPreferences.disabledLayers ?? []) renderer.disabledLayers.add(layer);
        }
        nextNetworkRefreshAt = Date.now() + (network.operators.some((operator) => operator.loading) ? 5_000 : network.operators.some((operator) => operator.status === 'unavailable') ? 60_000 : 6 * 3600_000);
        operatorRenderKey = '';
        setData(map, 'stops', stopsData(network.stops)); installVehicleIcons(map, network.routes);
        if (firstLoad) persistCityPreferences();
      } catch (error) {
        nextNetworkRefreshAt = Date.now() + 30_000;
        if (!network) throw error;
      }
    }
    snapshot = await loadSnapshot(); if (map.isStyleLoaded()) installVehicleIcons(map, snapshot.vehicles); renderer.update(snapshot.vehicles, snapshot.fetchedAt, snapshot.serverTime); debugInspector?.updateVehicles(snapshot.vehicles); filters(); renderDetails();
  } catch (error) { toast(error instanceof Error ? error.message : 'No se pudieron cargar los datos.'); $('#status').textContent = snapshot ? 'Actualización no disponible · datos anteriores' : 'Datos no disponibles · reintenta desde Capas'; }
  finally { polling = false; $('#refresh').textContent = '↻ Actualizar datos'; }
}
function search() {
  if (!network) { $('#results').innerHTML = '<p class="empty-copy">La red se está cargando…</p>'; return; }
  const query = $<HTMLInputElement>('#search').value;
  if (query.trim()) results = searchNetwork(network, query, mode, renderer.operators, renderer.disabledLayers);
  else { results = [...network.routes.filter((r) => favorites.has(`route:${r.key}`)).map((item): SearchResult => ({ type: 'route', item })), ...network.stops.filter((s) => favorites.has(`stop:${s.key}`)).map((item): SearchResult => ({ type: 'stop', item }))]; if (!results.length) results = network.places.map((item) => ({ type: 'place', item })); }
  resultIndex = -1;
  $('.search-heading').textContent = query ? `${results.length} resultados` : favorites.size ? 'Tus favoritos' : city.presentation.searchLabel;
  $('#results').innerHTML = results.map((r, i) => `<button id="result-${i}" class="search-result row" role="option" aria-selected="false" data-result="${i}">${r.type === 'route' ? badge(r.item) : `<span class="result-icon">${icon(r.type === 'stop' ? 'stop' : 'place')}</span>`}<span class="row-copy"><strong>${esc(r.type === 'route' ? r.item.longName || r.item.shortName : r.item.name)}</strong><small>${r.type === 'place' ? 'Lugar de la red' : `${r.type === 'route' ? 'Línea' : 'Parada / estación'} · ${esc(operatorName(r.item.operatorId))}`}</small></span><span>↗</span></button>`).join('') || '<p class="empty-copy">No encontramos coincidencias. Prueba una línea o el nombre de una estación.</p>';
  $('#search-results').hidden = false; $('#search').setAttribute('aria-expanded', 'true'); $('#clear-search').hidden = !query;
}
function closeSearch() { $('#search-results').hidden = true; $('#search').setAttribute('aria-expanded', 'false'); $('#search').removeAttribute('aria-activedescendant'); }
function chooseResult(index: number) { const result = results[index]; if (!result) return; closeSearch(); $('#search').blur(); if (result.type === 'route') void selectRoute(result.item); else if (result.type === 'stop') void selectStop(result.item); else { closeDetails(); map.easeTo({ center: [result.item.longitude, result.item.latitude], zoom: 15, duration: duration(850) }); } }
function setSheetCollapsed(collapsed: boolean, adjustMap = true) {
  const panel = $('#details'), handle = $('#sheet-handle');
  panel.classList.toggle('collapsed', collapsed);
  handle.setAttribute('aria-expanded', String(!collapsed));
  handle.setAttribute('aria-label', collapsed ? 'Expandir panel' : 'Reducir panel');
  window.clearTimeout(sheetTimer);
  if (adjustMap && selection && innerWidth < 700) sheetTimer = window.setTimeout(() => map.easeTo({ padding: padding(), duration: duration(220) }), duration(220));
}
function openPanel(collapsed = false) { $('#details').hidden = false; setSheetCollapsed(collapsed, false); closeSearch(); $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); detailError = ''; }
function beginDetailRequest() {
  detailRequest?.abort();
  detailRequest = new AbortController();
  return { version: ++detailVersion, signal: detailRequest.signal };
}
/** A vehicle has no favorite of its own: its star saves the line it runs on. */
function favoriteKey() { const vehicleRoute = selectedVehicle()?.routeKey; return selection?.kind === 'route' ? `route:${selection.route.key}` : selection?.kind === 'stop' ? `stop:${selection.stop.key}` : vehicleRoute && network?.routes.some((r) => r.key === vehicleRoute) ? `route:${vehicleRoute}` : null; }
function closeDetails() { detailRequest?.abort(); detailRequest = null; window.clearTimeout(sheetTimer); selection = null; detail = null; detailVersion++; following = false; renderer.focusRoute = null; renderer.selectedId = null; renderer.direction = 'all'; $('#details').hidden = true; $('#debug').hidden = true; map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: duration(300) }); setData(map, 'selected-route', empty); setData(map, 'selected-stops', empty); }
async function selectRoute(route: Route, direction = 'all', fit = true) {
  renderer.operators.add(route.operatorId); renderer.disabledLayers.delete(route.operatorId + ':' + route.mode); if (mode !== 'all' && mode !== route.mode) mode = route.mode; filters();
  selection = { kind: 'route', route, direction }; detail = null; returnVehicle = null; following = false; renderer.selectedId = null; renderer.focusRoute = route.key; renderer.direction = direction; openPanel(); renderDetails();
  setData(map, 'selected-route', empty); setData(map, 'selected-stops', empty); $('#detail-content').scrollTop = 0;
  const { version, signal } = beginDetailRequest();
  try { const result = await loadLine(route, direction, signal); if (version !== detailVersion) return; detail = result; result.shapes.forEach((s) => renderer.shapes.set(s.key, s)); setData(map, 'selected-route', routeData(result.shapes, route.color)); setData(map, 'selected-stops', stopsData(result.stops)); if (fit) fitShapes(map, result.shapes, padding(), duration(850)); renderDetails(); }
  catch (error) { if (!signal.aborted && version === detailVersion) { detailError = String((error as Error).message); renderDetails(); } }
}
async function selectStop(stop: Stop) {
  selection = { kind: 'stop', stop }; detail = null; returnVehicle = null; following = false; renderer.selectedId = null; renderer.focusRoute = null; openPanel(); setData(map, 'selected-route', empty); setData(map, 'selected-stops', stopsData([stop])); map.easeTo({ center: [stop.longitude, stop.latitude], zoom: Math.max(map.getZoom(), 15), padding: padding(), duration: duration(700) }); renderDetails();
  $('#detail-content').scrollTop = 0; const { version, signal } = beginDetailRequest();
  try { const result = await loadStop(stop, signal); if (version !== detailVersion) return; detail = result; setData(map, 'selected-stops', stopsData(result.nearbyStops)); renderDetails(); }
  catch (error) { if (!signal.aborted && version === detailVersion) { detailError = (error as Error).message; renderDetails(); } }
}
async function selectVehicle(vehicle: Vehicle) {
  renderer.operators.add(vehicle.operatorId); renderer.disabledLayers.delete(vehicle.operatorId + ':' + vehicle.mode); if (mode !== 'all' && mode !== vehicle.mode) mode = vehicle.mode; filters();
  selection = { kind: 'vehicle', id: vehicle.id }; detail = null; returnVehicle = null; following = false; renderer.selectedId = vehicle.id; renderer.focusRoute = vehicle.routeKey; debugInspector?.select(vehicle); renderer.direction = 'all';
  // On a phone a vehicle opens as a compact card, so the map around it stays visible; swipe up for the stops.
  openPanel(innerWidth < 700); renderDetails();
  const coordinate = renderer.coordinate(vehicle.id); if (coordinate) map.easeTo({ center: coordinate, zoom: Math.max(map.getZoom(), 14.5), padding: padding(), duration: duration(700) });
  setData(map, 'selected-route', empty); setData(map, 'selected-stops', empty); $('#detail-content').scrollTop = 0;
  const { version, signal } = beginDetailRequest();
  try { const result = await loadTrip(vehicle, signal); if (version !== detailVersion) return; detail = result; if (result.shape) { renderer.shapes.set(result.shape.key, result.shape); setData(map, 'selected-route', routeData([result.shape], vehicle.color)); } setData(map, 'selected-stops', stopsData(result.stops)); renderDetails(); void refresh(); }
  catch (error) { if (!signal.aborted && version === detailVersion) { detailError = (error as Error).message; renderDetails(); } }
}
function renderDetails() {
  if (!selection) return;
  $('#details').dataset.kind = selection.kind;
  const key = favoriteKey(), saved = !!key && favorites.has(key), what = selection.kind === 'stop' ? 'parada' : 'línea';
  $('#favorite').hidden = !key; $('#favorite').textContent = saved ? '★' : '☆'; $('#favorite').setAttribute('aria-pressed', String(saved));
  $('#favorite').setAttribute('aria-label', saved ? `Quitar ${what} de favoritos` : `Guardar ${what} en favoritos`); $('#favorite').title = $('#favorite').getAttribute('aria-label')!;
  $('#back').hidden = selection.kind === 'vehicle' || !returnVehicle || !snapshot?.vehicles.some((v) => v.id === returnVehicle);
  const loading = detailError ? `<div class="detail-error">${esc(detailError)}<button class="text-button" data-retry>Reintentar</button></div>` : '<p class="loading-copy">Consultando servicios…</p>';
  if (selection.kind === 'vehicle') {
    const v = selectedVehicle();
    if (!v) { $('#detail-content').innerHTML = '<div class="detail-heading"><h1>Servicio finalizado</h1><p>Este vehículo ya no aparece entre los servicios activos.</p></div>'; return; }
    const q = positionQuality(v, Date.now() + renderer.clockOffset), trip = detail as TripDetail | null;
    const delay = v.delaySeconds;
    const renderedProgress = renderer.progressMeters(v.id) ?? v.progressMetersAlongShape;
    const next = trip ? nextStopAhead(trip.stops.filter((stop) => !stop.skipped), renderedProgress) : undefined;
    const nextName = trip ? next?.name ?? 'Fin del recorrido' : 'Calculando posición…';
    const clock = Date.now() + renderer.clockOffset;
    const nextAt = next?.at != null ? consistentArrival(next.at, clock, !!next.realtime, next.progress != null ? next.progress - renderedProgress : null, renderer.diagnostics(v.id)?.renderedSpeed ?? 0) : null;
    const nextArrival = nextAt != null ? `${reliabilityBadge(arrivalReliability(next!.realtime ? 'realtime' : next!.source, null, Date.now()).level)} · ${arrivalLabel(nextAt, clock)}` : 'Sin hora disponible';
    $('#detail-content').innerHTML = `<div class="detail-heading"><div class="eyebrow">${kindIcon(vehicleKind(v))}${esc(v.operatorName)} · ${{ metro: 'Metro', train: 'Tren', tram: 'Tranvía', funicular: 'Funicular', bus: 'Bus' }[vehicleKind(v) as string] ?? 'Transporte'}</div><div class="title-row">${badge(v)}<h1>${esc(v.headsign || 'Servicio en circulación')}</h1></div>${reliabilityBadge(vehicleReliability(v, Date.now() + renderer.clockOffset).level)}<p class="quality-explanation">${esc(positionExplanation(v, Date.now() + renderer.clockOffset))}</p></div><${next ? `button class="next-stop" data-stop="${esc(next.key)}" aria-label="Próxima parada: ${esc(nextName)}. Ver sus próximos servicios"` : 'div class="next-stop"'}><span>Próxima parada</span><strong>${esc(nextName)}</strong><span class="next-arrival">${nextArrival}${delay !== null ? `<small> · ${v.delayEstimated ? 'Desfase estimado · ' : ''}${delayLabel(delay)}</small>` : ''}</span>${next ? '<span class="next-chevron" aria-hidden="true">›</span></button>' : '</div>'}<div class="detail-actions"><button data-follow class="${following ? 'primary' : ''}" aria-pressed="${following}" title="${following ? 'Toca para dejar de seguirlo' : 'Mantener el vehículo en el centro del mapa'}">${icon('follow')}${following ? 'Siguiendo' : 'Seguir'}</button><button data-full-line>${icon('route')}Ver línea</button><button data-fit>${icon('fit')}Recorrido</button></div><section class="detail-section"><h2>Paradas del recorrido</h2>${trip ? stopRows(trip.stops, renderedProgress) : loading}</section>`;
    if (new URLSearchParams(location.search).has('debug')) { $('#debug').hidden = false; $('#debug').textContent = `trip: ${v.tripId}\nshape: ${v.shapeKey}\nprogress: ${v.progressMetersAlongShape.toFixed(1)} m\nrendered coordinate: ${renderer.coordinate(v.id)?.map(n => n.toFixed(6)).join(", ")}\nquality: ${q}\nGPS: ${v.observationTimestamp ? new Date(v.observationTimestamp).toISOString() : 'none'}\nlast query: ${snapshot ? new Date(snapshot.fetchedAt).toISOString() : 'none'}\nrender frame: ${new Date().toISOString()}\nmotion time: ${new Date(renderer.renderedTimestamp(v.id)).toISOString()}\nrendered: ${renderer.renderedVehicles} / ${renderer.getVehicles().length}\nframe: ${renderer.renderMilliseconds.toFixed(2)} ms\nspeed: ${v.speedMetersPerSecond?.toFixed(1) ?? 'unknown'} m/s\nshape cache: ${renderer.shapes.size}\n${following ? 'following' : ''}`; }
    if (new URLSearchParams(location.search).has('debug')) $('#debug').textContent += `\nLOD: ${renderer.lod}\n3D fallback: ${renderer.modelFallbackReason}\n3D vehicles/cars: ${renderer.modelVehicles}/${renderer.modelCars}\nmotion: ${JSON.stringify(renderer.diagnostics(v.id), null, 2)}`;
    if (new URLSearchParams(location.search).has('debug')) $('#debug').textContent += `\nsource timestamp: ${v.sourceTimestamp === null ? 'unknown' : new Date(v.sourceTimestamp).toISOString()}\nreceived timestamp: ${v.receivedTimestamp === null ? 'unknown' : new Date(v.receivedTimestamp).toISOString()}\nposition source: ${v.positionSource}\ntimeline source: ${v.timelineSource ?? 'unknown'}\nrendered position source: ${renderer.positionSource(v.id)}`;
  } else if (selection.kind === 'route') {
    const route = selection.route, line = detail as LineDetail | null;
    const active = renderer.getVehicles().filter((v) => v.routeKey === route.key && (selection?.kind !== 'route' || selection.direction === 'all' || String(v.directionId ?? 'unknown') === selection.direction));
    $('#detail-content').innerHTML = `<div class="detail-heading"><div class="eyebrow">${esc(operatorName(route.operatorId))}</div><div class="title-row">${badge(route)}<h1>${esc(route.longName || route.shortName)}</h1></div><p>${active.length} vehículos activos</p></div><div class="direction-control"><label for="direction">Sentido</label><select id="direction"><option value="all">Todos los sentidos</option>${route.directions.map((d) => `<option value="${esc(d.id)}" ${selection?.kind === 'route' && selection.direction === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div><section class="detail-section"><h2>Ahora en circulación</h2>${active.length ? active.slice(0, 12).map((v) => `<button class="row vehicle-row" data-vehicle="${esc(v.id)}"><span class="result-icon">${kindIcon(vehicleKind(v))}</span><span class="row-copy"><strong>${esc(v.headsign || route.longName)}</strong><small>${esc(v.nextStop?.name ?? 'En recorrido')}</small></span>${reliabilityBadge(vehicleReliability(v, Date.now() + renderer.clockOffset).level)}</button>`).join('') : '<p class="empty-copy">No hay vehículos activos con este sentido y estos filtros.</p>'}</section><section class="detail-section"><h2>Próximas salidas desde cabecera</h2>${line ? departures(line.departures, operatorName) : loading}</section><section class="detail-section"><h2>Paradas ${selection.direction === 'all' ? '· recorrido de referencia' : ''}</h2>${line ? stopRows(line.stops) : ''}</section>`;
  } else {
    const stop = selection.stop, data = detail as StopDetail | null;
    $('#detail-content').innerHTML = `<div class="detail-heading"><div class="eyebrow">Parada / estación</div><h1>${esc(stop.name)}</h1><p>${data ? [...new Set(data.nearbyStops.map((s) => operatorName(s.operatorId)))].map(esc).join(' · ') : esc(operatorName(stop.operatorId))}</p></div><section class="detail-section"><div class="section-heading"><h2>Próximos servicios</h2><small>Hora local</small></div>${data ? departures(data.departures, operatorName) : loading}<p class="section-note">Incluye otras paradas a menos de 30 m en el mismo sentido. Las llegadas marcadas como horario pueden variar.</p></section>`;
  }
}
function stopRows(stops: (Stop & { at?: number | null; progress?: number; skipped?: boolean; realtime?: boolean; source?: TripDetail['stops'][number]['source'] })[], progress = -1) {
  const level = (s: (typeof stops)[number]) => arrivalReliability(s.realtime ? 'realtime' : s.source, null, Date.now()).level;
  return `<ol class="stop-timeline">${stops.map((s) => `<li class="${s.progress !== undefined && s.progress < progress - 10 ? 'passed' : ''}"><button data-stop="${esc(s.key)}"><span>${esc(s.name)}</span>${s.skipped ? '<small>No para</small>' : s.at ? `<small class="reliability ${level(s)}" title="${RELIABILITY_LABELS[level(s)]}"><i></i>${time(s.at)}</small>` : ''}</button></li>`).join('')}</ol>`;
}
/** Zen mode: only the network in motion, without labels or interface. The camera stays free, except with a vehicle selected: then it follows that vehicle. */
function setZen(enabled: boolean) {
  if (zen === enabled) return;
  zen = enabled;
  document.documentElement.classList.toggle('zen', enabled);
  $('#zen-exit').hidden = !enabled;
  if (enabled) { closeSearch(); $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); (document.activeElement as HTMLElement | null)?.blur(); }
  // With a vehicle selected, zen mode hides its card and keeps it in view: the camera follows it until the map is dragged.
  if (enabled && selection?.kind === 'vehicle' && selectedVehicle() && !following) setFollowing(true);
  applyZenMap();
  map.easeTo({ padding: padding(), duration: duration(400) });
  wakeZen(enabled ? 3500 : 0);
}
function applyZenMap() {
  zenLayers.apply(map, zen);
  // Without clusters every vehicle moves on its own, even with the whole city in view.
  void (map.getSource('vehicles') as import('maplibre-gl').GeoJSONSource | undefined)?.setClusterOptions({ cluster: !zen, clusterMaxZoom: 10, clusterRadius: 42 });
}
/** Shows the way out of zen mode for a moment: on a mouse movement, a tap or on entering. A finger gets longer to reach it. */
function wakeZen(milliseconds = matchMedia('(pointer: coarse)').matches ? 4500 : 2500) {
  window.clearTimeout(zenWakeTimer);
  document.documentElement.classList.toggle('zen-awake', zen && milliseconds > 0);
  if (zen && milliseconds > 0) zenWakeTimer = window.setTimeout(() => document.documentElement.classList.remove('zen-awake'), milliseconds);
}
function drawSelection() {
  if (!detail || !selection) return;
  if (selection.kind === 'route') { const d = detail as LineDetail; setData(map, 'selected-route', routeData(d.shapes, selection.route.color)); setData(map, 'selected-stops', stopsData(d.stops)); }
  if (selection.kind === 'stop') setData(map, 'selected-stops', stopsData((detail as StopDetail).nearbyStops));
  if (selection.kind === 'vehicle') { const d = detail as TripDetail, v = selectedVehicle(); if (d.shape && v) setData(map, 'selected-route', routeData([d.shape], v.color)); setData(map, 'selected-stops', stopsData(d.stops)); }
}
map.on('style.load', () => { installLayers(map, network, isDark()); if (snapshot) installVehicleIcons(map, snapshot.vehicles); debugInspector?.installMapLayers(); filters(); drawSelection(); zenLayers.reset(); if (zen) applyZenMap(); });
map.on('error', (event) => { if (event.error.message.includes('WebGL')) toast('El mapa necesita un navegador con WebGL activado.'); });
/** How far from a vehicle or stop a tap still selects it: a finger needs more room than a pointer. */
const hitTolerance = () => matchMedia('(pointer: coarse)').matches ? 22 : 12;
const nearbyFeatures = (point: { x: number; y: number }, layers: string[], tolerance: number) => {
  const present = layers.filter((l) => map.getLayer(l)); if (!present.length) return [];
  return map.queryRenderedFeatures([[point.x - tolerance, point.y - tolerance], [point.x + tolerance, point.y + tolerance]], { layers: present });
};
map.on('click', async (event) => {
  // In zen mode a tap only brings back the way out.
  if (zen) { wakeZen(); return; }
  const cluster = nearbyFeatures(event.point, ['clusters'], 0)[0];
  if (cluster?.properties?.cluster_id !== undefined) { const source = map.getSource('vehicles') as import('maplibre-gl').GeoJSONSource; const zoom = await source.getClusterExpansionZoom(Number(cluster.properties.cluster_id)); if (cluster.geometry.type === 'Point') map.easeTo({ center: cluster.geometry.coordinates as [number, number], zoom }); return; }
  const vehicleId = renderer.vehicleAt(event.point, hitTolerance());
  if (vehicleId) { const v = snapshot?.vehicles.find((v) => v.id === vehicleId); if (v) void selectVehicle(v); return; }
  const stop = nearbyFeatures(event.point, ['selected-stops-dot', 'stations', 'bus-stops'], hitTolerance() / 2)[0];
  if (stop?.properties?.key) { const s = network?.stops.find((s) => s.key === stop.properties.key); if (s) void selectStop(s); return; }
  closeSearch(); if (selection && innerWidth < 700) setSheetCollapsed(true);
});
let hoverFrame = 0;
map.on('mousemove', (event) => {
  if (hoverFrame || zen) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const hit = renderer.vehicleAt(event.point, hitTolerance()) || nearbyFeatures(event.point, ['clusters', 'stations', 'bus-stops', 'selected-stops-dot'], hitTolerance() / 2).length;
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
  });
});
/** Panning the map is looking elsewhere, so it lets go of the vehicle; a two-finger pinch or turn keeps following it. */
map.on('dragstart', (event) => {
  const original = event.originalEvent as (MouseEvent | TouchEvent) | undefined;
  if (!original || !following || ('touches' in original && original.touches.length > 1)) return;
  setFollowing(false);
  if (!zen) toast('Ya no sigues el vehículo · toca «Seguir» para volver a él');
});
const followCamera = new FollowCamera(map);
function setFollowing(enabled: boolean) {
  following = enabled; followCamera.reset();
  if (enabled) { $('#toast').hidden = true; window.clearTimeout(toastTimer); }
  renderDetails();
}
renderer.onSelectedPosition = (coordinate) => { if (following) followCamera.update(coordinate, Date.now(), padding(), duration(600)); };
renderer.start();
$<HTMLInputElement>('#search').addEventListener('input', search);
$('#search').addEventListener('focus', search);
$('#search').addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!results.length) return; resultIndex = (resultIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; document.querySelectorAll('[data-result]').forEach((r, i) => { r.classList.toggle('highlight', i === resultIndex); r.setAttribute('aria-selected', String(i === resultIndex)); }); $('#search').setAttribute('aria-activedescendant', `result-${resultIndex}`); $(`#result-${resultIndex}`).scrollIntoView({ block: 'nearest' }); } if (event.key === 'Enter') { event.preventDefault(); chooseResult(Math.max(0, resultIndex)); } });
$('#clear-search').onclick = () => { $<HTMLInputElement>('#search').value = ''; search(); $('#search').focus(); };
$('#results').onclick = (event) => { const item = (event.target as HTMLElement).closest<HTMLElement>('[data-result]'); if (item) chooseResult(Number(item.dataset.result)); };
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.onclick = () => { mode = button.dataset.mode as typeof mode; filters(); persistCityPreferences(); if (!$('#search-results').hidden) search(); renderDetails(); });
$('#layers-button').onclick = () => { $('#layers').hidden = !$('#layers').hidden; $('#layers-button').setAttribute('aria-expanded', String(!$('#layers').hidden)); closeSearch(); };
$('[data-close-layers]').onclick = () => { $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); };
$('#operator-list').addEventListener('change', (event) => { const input = event.target as HTMLInputElement; if (input.dataset.operator) { if (input.dataset.transport) { const key = input.dataset.operator + ':' + input.dataset.transport; renderer.operators.add(input.dataset.operator); if (input.checked) renderer.disabledLayers.delete(key); else renderer.disabledLayers.add(key); } else if (input.checked) renderer.operators.add(input.dataset.operator); else renderer.operators.delete(input.dataset.operator); filters(); persistCityPreferences(); renderDetails(); } });
function changeTheme() { document.documentElement.dataset.theme = isDark() ? 'dark' : 'light'; map.setStyle(styleUrl(isDark())); }
$('#theme').addEventListener('change', () => { theme = $<HTMLSelectElement>('#theme').value; write('transit:theme', theme); changeTheme(); });
media.addEventListener('change', () => { if (theme === 'system') changeTheme(); });
$('#underground').onchange = () => { renderer.showUnderground = $<HTMLInputElement>('#underground').checked; persistCityPreferences(); };
map.on('moveend', () => { void ensureShapes(); if (!following) { window.clearTimeout(cameraSaveTimer); cameraSaveTimer = window.setTimeout(persistCityPreferences, 250); } });
$('#refresh').onclick = () => { void refresh(); };
$('#close-details').onclick = closeDetails;
let touchY = 0, swipeSheet = false, ignoreSheetClick = false;
$('#sheet-handle').onclick = () => { if (ignoreSheetClick) { ignoreSheetClick = false; return; } setSheetCollapsed(!$('#details').classList.contains('collapsed')); };
// The handle drags the sheet; the compact card can be dragged from anywhere: up to open it, down to close it.
$('#details').addEventListener('touchstart', (event) => { touchY = event.touches[0].clientY; swipeSheet = innerWidth < 700 && (!!(event.target as HTMLElement).closest('#sheet-handle') || $('#details').classList.contains('collapsed')); }, { passive: true });
$('#details').addEventListener('touchend', (event) => {
  const delta = event.changedTouches[0].clientY - touchY; if (!swipeSheet || Math.abs(delta) <= 30) return;
  ignoreSheetClick = true; window.setTimeout(() => { ignoreSheetClick = false; }, 500);
  if (delta > 0 && $('#details').classList.contains('collapsed')) closeDetails(); else setSheetCollapsed(delta > 0);
}, { passive: true });
// A tap on the compact card, outside its buttons, opens it.
$('#details').addEventListener('click', (event) => { if (innerWidth < 700 && !ignoreSheetClick && $('#details').classList.contains('collapsed') && !(event.target as HTMLElement).closest('button, select, a')) setSheetCollapsed(false); });
/** On a phone the map buttons sit above the card, and give way while an open card leaves them no room. */
function placeMapControls() {
  const panel = $('#details'), controls = $('.map-controls'), open = innerWidth < 700 && !!selection && !panel.hidden;
  const cover = open ? Math.max(0, innerHeight - panel.getBoundingClientRect().top) : 0;
  document.documentElement.classList.toggle('sheet-open', open);
  document.documentElement.style.setProperty('--sheet-cover', `${Math.round(cover)}px`);
  controls.classList.toggle('crowded', open && innerHeight - cover - 10 - controls.offsetHeight < $('.search-shell').getBoundingClientRect().bottom + 8);
}
new ResizeObserver(placeMapControls).observe($('#details'));
window.addEventListener('resize', placeMapControls);
$('#favorite').onclick = () => { const key = favoriteKey(); if (!key) return; if (favorites.has(key)) favorites.delete(key); else favorites.add(key); write('transit:favorites', JSON.stringify([...favorites])); renderDetails(); };
$('#back').onclick = () => { const v = snapshot?.vehicles.find((v) => v.id === returnVehicle); if (v) void selectVehicle(v); };
/** Opens a line or stop from the vehicle card, keeping the way back to the vehicle. */
function openFromVehicle(open: () => void) { const from = selection?.kind === 'vehicle' ? selection.id : null; open(); returnVehicle = from; renderDetails(); }
$('#detail-content').onclick = (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!target) return;
  if (target.dataset.stop) { const s = network?.stops.find((s) => s.key === target.dataset.stop); if (s) openFromVehicle(() => void selectStop(s)); }
  if (target.dataset.route) { const r = network?.routes.find((r) => r.key === target.dataset.route); if (r) void selectRoute(r); }
  if (target.dataset.vehicle) { const v = snapshot?.vehicles.find((v) => v.id === target.dataset.vehicle); if (v) void selectVehicle(v); }
  if (target.hasAttribute('data-follow')) setFollowing(!following);
  if (target.hasAttribute('data-fit') && detail && 'shape' in detail && detail.shape) { following = false; fitShapes(map, [detail.shape], padding(), duration(850)); renderDetails(); }
  if (target.hasAttribute('data-full-line')) { const v = selectedVehicle(), route = network?.routes.find((r) => r.key === v?.routeKey); if (route) openFromVehicle(() => void selectRoute(route, 'all', false)); }
  if (target.hasAttribute('data-retry')) { if (selection?.kind === 'route') void selectRoute(selection.route, selection.direction, false); else if (selection?.kind === 'stop') void selectStop(selection.stop); else { const v = selectedVehicle(); if (v) void selectVehicle(v); } }
};
$('#detail-content').addEventListener('change', (event) => { const select = event.target as HTMLSelectElement; if (select.id === 'direction' && selection?.kind === 'route') void selectRoute(selection.route, select.value); });
$('#zoom-in').onclick = () => map.zoomIn(); $('#zoom-out').onclick = () => map.zoomOut(); $('#north').onclick = () => map.easeTo({ bearing: 0 });
$('#zen').onclick = () => setZen(true); $('#zen-layers').onclick = () => setZen(true);
$('#zen-exit').onclick = (event) => { setZen(false); if (event.detail === 0) $('#zen').focus(); };
document.addEventListener('pointermove', (event) => { if (zen && event.pointerType === 'mouse') wakeZen(); });
$('#perspective').onclick = () => { const enabled = map.getPitch() < 20; map.easeTo({ pitch: enabled ? 50 : 0, duration: duration(650) }); $('#perspective').classList.toggle('active', enabled); $('#perspective').setAttribute('aria-pressed', String(enabled)); };
$('#locate').onclick = () => { if (!navigator.geolocation) { toast('Este navegador no ofrece ubicación.'); return; } navigator.geolocation.getCurrentPosition((p) => { const coordinates: [number, number] = [p.coords.longitude, p.coords.latitude]; setData(map, 'user-location', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } }] }); map.easeTo({ center: coordinates, zoom: 15, padding: padding() }); }, () => toast('No se pudo obtener tu ubicación. Comprueba los permisos del navegador.'), { timeout: 12000, maximumAge: 30000 }); };
document.addEventListener('keydown', (event) => { if (isZenShortcut(event, event.target as HTMLElement)) { event.preventDefault(); setZen(!zen); return; } if (zen && (event.key === 'Escape' || event.key === '/')) { setZen(false); if (event.key === 'Escape') return; } if (event.key === 'Escape') { if (!$('#search-results').hidden) closeSearch(); else if (!$('#layers').hidden) $('[data-close-layers]').click(); else closeDetails(); } if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); $('#search').focus(); } });
document.addEventListener('pointerdown', (event) => { const target = event.target as HTMLElement; if (!target.closest('.search-shell')) closeSearch(); if (!target.closest('#layers, #layers-button')) { $('#layers').hidden = true; $('#layers-button').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
window.addEventListener('online', () => { void refresh(); }); window.addEventListener('offline', updateStatus);
window.setInterval(() => { if (!document.hidden) { void refresh(); } }, 15000);
window.setInterval(() => { if (!document.hidden) { updateStatus(); renderDetails(); } }, 10000);
window.setInterval(async () => { const current = selection, version = detailVersion; if (!current || document.hidden || !navigator.onLine) return; try { const vehicle = selectedVehicle(); const fresh = current.kind === 'stop' ? await loadStop(current.stop) : current.kind === 'route' ? await loadLine(current.route, current.direction) : vehicle ? await loadTrip(vehicle) : null; if (version === detailVersion && fresh) { detail = fresh; renderDetails(); } } catch { /* Keep previous detail; stale arrivals revert visibly to schedule. */ } }, 15000);
void refresh();
window.addEventListener('pagehide', () => renderer.stop());
window.addEventListener('pageshow', () => renderer.start());
