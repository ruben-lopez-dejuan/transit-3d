import type { Map as TransitMap, GeoJSONSource } from 'maplibre-gl';
import type { TransitDebugTrace } from '../shared/transit/debug';
import type { Vehicle } from './transit/networkTypes';
import { positionAlong } from './transit/motion';
import type { TransitRenderer } from './map/transitRenderer';
import './debug.css';

const TOKEN_KEY = 'transit-3d-admin-token';
const empty = () => ({ type: 'FeatureCollection' as const, features: [] });
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clock = (value: number | null | undefined) => value == null ? 'desconocido' : new Date(value).toLocaleTimeString('es-ES', { hour12: false, fractionalSecondDigits: 3 });
const elapsed = (ms: number | null | undefined) => ms == null || !Number.isFinite(ms) ? 'desconocido' : Math.abs(ms) < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(Math.abs(ms) < 10_000 ? 2 : 1) + ' s';
const meters = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? 'desconocido' : n.toFixed(1) + ' m';
const speed = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? 'desconocida' : n.toFixed(2) + ' m/s';
function distance(a: [number, number] | null, b: [number, number] | null) {
  if (!a || !b) return null;
  const r = Math.PI / 180, latitude = (a[1] + b[1]) * .5 * r;
  return Math.hypot((b[0] - a[0]) * r * Math.cos(latitude), (b[1] - a[1]) * r) * 6_371_000;
}

export class DebugInspector {
  private vehicles: Vehicle[] = [];
  private selectedId: string | null = null;
  private trace: TransitDebugTrace | null = null;
  private request: AbortController | null = null;
  private readonly element: HTMLElement;
  private readonly renderTimer: number;
  private readonly traceTimer: number;

  constructor(private readonly options: { map: TransitMap; renderer: TransitRenderer; cityId: string; selectVehicle: (vehicle: Vehicle) => void }) {
    const shell = '<aside id="debug-inspector" aria-label="Inspector de posiciones">' +
      '<header><div><small>Transit 3D</small><h1>Inspector de posiciones</h1></div><a href="/">Cerrar</a></header>' +
      '<div class="debug-search"><input id="debug-search" type="search" placeholder="Línea, operador, destino o ID"><span id="debug-count">0 vehículos</span></div>' +
      '<div id="debug-vehicle-list" class="debug-vehicle-list"></div><section id="debug-selected"><p class="debug-empty">Selecciona un vehículo del mapa o de la lista.</p></section></aside>';
    document.body.insertAdjacentHTML('beforeend', shell);
    this.element = document.querySelector('#debug-inspector')!;
    this.element.querySelector<HTMLInputElement>('#debug-search')!.addEventListener('input', () => this.renderList());
    this.element.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-debug-vehicle],[data-debug-auth],[data-debug-copy]');
      if (!target) return;
      if (target.dataset.debugVehicle) {
        const vehicle = this.vehicles.find((candidate) => candidate.id === target.dataset.debugVehicle);
        if (vehicle) this.options.selectVehicle(vehicle);
      }
      if (target.hasAttribute('data-debug-auth')) {
        const token = this.element.querySelector<HTMLInputElement>('#debug-token')?.value.trim();
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        void this.refreshTrace();
      }
      if (target.hasAttribute('data-debug-copy')) void navigator.clipboard?.writeText(JSON.stringify(this.report(), null, 2));
    });
    this.renderTimer = window.setInterval(() => this.updateLiveOverlay(), 500);
    this.traceTimer = window.setInterval(() => { if (!document.hidden && this.selectedId) void this.refreshTrace(); }, 5_000);
  }

  installMapLayers() {
    const map = this.options.map;
    if (!map.isStyleLoaded()) return;
    if (!map.getSource('debug-position-trace')) map.addSource('debug-position-trace', { type: 'geojson', data: empty() });
    if (!map.getLayer('debug-position-lines')) map.addLayer({ id: 'debug-position-lines', type: 'line', source: 'debug-position-trace', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': .78, 'line-dasharray': [2, 1.5] } });
    if (!map.getLayer('debug-position-points')) map.addLayer({
      id: 'debug-position-points', type: 'circle', source: 'debug-position-trace',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        // Largest to smallest, in source order: coincident stages remain visible
        // as concentric rings without moving their real coordinates.
        'circle-color': ['get', 'color'],
        'circle-radius': ['match', ['get', 'stage'], 'provider', 18, 'projected', 14, 'predicted', 10, 7],
        'circle-opacity': ['match', ['get', 'stage'], 'provider', .22, 'projected', .3, 'predicted', .42, .9],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
      },
    });
    this.updateOverlay();
  }

  updateVehicles(vehicles: Vehicle[]) {
    this.vehicles = vehicles;
    this.renderList();
    const requested = new URL(location.href).searchParams.get('vehicle');
    if (!this.selectedId && requested) {
      const vehicle = vehicles.find((candidate) => candidate.id === requested);
      if (vehicle) this.options.selectVehicle(vehicle);
    }
  }

  select(vehicle: Vehicle) {
    if (this.selectedId === vehicle.id) return;
    this.selectedId = vehicle.id;
    this.trace = null;
    const url = new URL(location.href);
    url.searchParams.set('vehicle', vehicle.id);
    history.replaceState(history.state, '', url);
    this.renderList();
    this.renderCurrent();
    void this.refreshTrace();
  }

  destroy() { window.clearInterval(this.renderTimer); window.clearInterval(this.traceTimer); this.request?.abort(); }
  private current() { return this.vehicles.find((vehicle) => vehicle.id === this.selectedId) ?? null; }

  private renderList() {
    const input = this.element.querySelector<HTMLInputElement>('#debug-search')!;
    const query = input.value.trim().toLocaleLowerCase('es');
    const matches = this.vehicles.filter((v) => !query || [v.label, v.operatorName, v.headsign, v.destination, v.externalVehicleId, v.id].some((x) => String(x ?? '').toLocaleLowerCase('es').includes(query))).slice(0, 80);
    this.element.querySelector('#debug-count')!.textContent = this.vehicles.length + ' vehículos';
    this.element.querySelector('#debug-vehicle-list')!.innerHTML = matches.map((v) =>
      '<button data-debug-vehicle="' + esc(v.id) + '" class="' + (v.id === this.selectedId ? 'active' : '') + '"><strong>' + esc(v.label || '?') + '</strong><span>' + esc(v.operatorName) + ' · ' + esc(v.destination || v.headsign) + '</span><small>' + esc(v.positionSource) + ' · ' + clock(v.sourceTimestamp) + '</small></button>'
    ).join('') || '<p class="debug-empty">No hay coincidencias.</p>';
  }

  private async refreshTrace() {
    const vehicle = this.current();
    if (!vehicle) return;
    this.request?.abort();
    this.request = new AbortController();
    const token = sessionStorage.getItem(TOKEN_KEY);
    try {
      const response = await fetch('/api/admin/debug/cities/' + encodeURIComponent(this.options.cityId) + '/vehicles/' + encodeURIComponent(vehicle.id), { cache: 'no-store', headers: token ? { 'X-Admin-Token': token } : {}, signal: this.request.signal });
      const body = await response.json();
      if (!response.ok) { const error = new Error(body.error || 'No se pudo cargar la traza.'); Object.assign(error, { status: response.status }); throw error; }
      this.trace = body as TransitDebugTrace;
      this.renderCurrent();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const unauthorized = (error as Error & { status?: number }).status === 401;
      this.element.querySelector('#debug-selected')!.innerHTML = '<div class="debug-heading"><h2>' + esc(vehicle.label) + ' · ' + esc(vehicle.operatorName) + '</h2></div><p class="debug-error">' + esc(error instanceof Error ? error.message : error) + '</p>' +
        (unauthorized ? '<div class="debug-token"><input id="debug-token" type="password" placeholder="TRANSIT_ADMIN_TOKEN"><button data-debug-auth>Acceder</button></div>' : '<button class="debug-retry" data-debug-auth>Reintentar</button>');
    }
  }

  private renderCurrent() {
    const vehicle = this.current();
    if (!vehicle) return;
    const diagnostics = this.options.renderer.diagnostics(vehicle.id);
    const now = Date.now() + this.options.renderer.clockOffset;
    const rendered = this.options.renderer.coordinate(vehicle.id);
    const raw: [number, number] | null = this.trace?.adapter ? [this.trace.adapter.longitude, this.trace.adapter.latitude] : null;
    const shape = this.options.renderer.shapes.get(vehicle.shapeKey);
    const observedProgress = this.trace?.normalized?.observationProgressMeters ?? this.trace?.normalized?.progressMetersAlongShape ?? vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape;
    const projected = shape ? positionAlong(shape, observedProgress)?.coordinate ?? null : null;
    const predicted = shape && diagnostics ? positionAlong(shape, diagnostics.predictedProgress)?.coordinate ?? null : null;
    const history = this.trace?.history.slice().reverse() ?? [];
    const last = this.trace?.history.at(-1);
    const coordinates = [raw, projected, predicted, rendered].filter((coordinate): coordinate is [number, number] => coordinate !== null);
    const maximumSeparation = coordinates.reduce((maximum, coordinate, index) => Math.max(maximum, ...coordinates.slice(index + 1).map((other) => distance(coordinate, other) ?? 0)), 0);
    const overlapping = coordinates.length > 1 && maximumSeparation < 3;
    const rows: [string, unknown][] = [
      ['Fuente', vehicle.positionSource], ['Fuente timestamp', clock(vehicle.sourceTimestamp)], ['Recibido timestamp', clock(vehicle.receivedTimestamp)],
      ['Render timestamp', clock(this.options.renderer.renderedTimestamp(vehicle.id))], ['Antigüedad de fuente', elapsed(vehicle.sourceTimestamp === null ? null : now - vehicle.sourceTimestamp)],
      ['Fuente → recepción', elapsed(vehicle.sourceTimestamp === null || vehicle.receivedTimestamp === null ? null : vehicle.receivedTimestamp - vehicle.sourceTimestamp)],
      ['Recepción → consulta', elapsed(vehicle.receivedTimestamp === null || !last ? null : last.adapterFetchedAt - vehicle.receivedTimestamp)],
      ['Progress observado', meters(observedProgress)], ['Progress renderizado', meters(diagnostics?.renderedProgress)], ['Objetivo predicho', meters(diagnostics?.predictedProgress)],
      ['Error de corrección', meters(diagnostics?.correctionErrorMeters)], ['Distancia GPS / pantalla', meters(distance(raw, rendered))],
      ['Velocidad fuente', speed(vehicle.speedMetersPerSecond)], ['Velocidad renderizada', speed(diagnostics?.renderedSpeed)], ['Velocidad corrección', speed(diagnostics?.correctionSpeed)],
      ['Cadencia', elapsed(diagnostics?.cadenceSeconds == null ? null : diagnostics.cadenceSeconds * 1000)], ['Calidad renderizada', this.options.renderer.positionSource(vehicle.id) ?? 'desconocida'],
      ['Separación máxima', meters(maximumSeparation)], ['LOD', this.options.renderer.lod + ' · ' + this.options.renderer.modelFallbackReason],
    ];
    const selected = this.element.querySelector('#debug-selected')!;
    selected.innerHTML = '<div class="debug-heading"><div><small>' + esc(vehicle.id) + '</small><h2>' + esc(vehicle.label) + ' · ' + esc(vehicle.operatorName) + '</h2><p>' + esc(vehicle.destination || vehicle.headsign) + '</p></div><button data-debug-copy>Copiar informe</button></div>' +
      '<div class="debug-legend"><span><i style="--dot:#e7473c"></i>Proveedor</span><span><i style="--dot:#2584e8"></i>Proyectada</span><span><i style="--dot:#e8a128"></i>Objetivo</span><span><i style="--dot:#27a96b"></i>Pantalla</span></div>' +
      (overlapping ? '<p class="debug-overlap">Las posiciones coinciden: se muestran como anillos concéntricos, de proveedor (exterior) a pantalla (interior).</p>' : '') +
      '<dl class="debug-metrics">' + rows.map(([label, value]) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>' +
      (diagnostics?.rejected ? '<p class="debug-warning">Último dato rechazado: ' + esc(diagnostics.rejected) + '</p>' : '') +
      '<details open><summary>Historial de observaciones (' + history.length + ')</summary><div class="debug-history"><table><thead><tr><th>Fuente</th><th>Recibido</th><th>Capturado</th><th>Progress</th></tr></thead><tbody>' +
      (history.map((item) => '<tr><td>' + clock(item.sourceTimestamp) + '</td><td>' + clock(item.receivedTimestamp) + '</td><td>' + clock(item.capturedAt) + '</td><td>' + meters(item.adapterProgress) + '</td></tr>').join('') || '<tr><td colspan="4">Sin observaciones físicas guardadas.</td></tr>') +
      '</tbody></table></div></details>' + this.payload('Dato recibido del provider', this.trace?.adapter ?? null) + this.payload('Vehículo normalizado', this.trace?.normalized ?? null) +
      this.payload('Dato enviado al frontend', this.trace?.presentation ?? vehicle) + this.payload('Estado del motor', { diagnostics, renderedCoordinate: rendered, renderedPositionSource: this.options.renderer.positionSource(vehicle.id), renderTime: now });
    this.updateOverlay({ raw, projected, predicted, rendered, history });
  }

  private payload(title: string, value: unknown) { return '<details><summary>' + esc(title) + '</summary><pre>' + esc(JSON.stringify(value, null, 2)) + '</pre></details>'; }

  private updateLiveOverlay() {
    const vehicle = this.current();
    if (!vehicle) return;
    const diagnostics = this.options.renderer.diagnostics(vehicle.id);
    const shape = this.options.renderer.shapes.get(vehicle.shapeKey);
    const progress = this.trace?.normalized?.observationProgressMeters ?? this.trace?.normalized?.progressMetersAlongShape ?? vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape;
    this.updateOverlay({
      raw: this.trace?.adapter ? [this.trace.adapter.longitude, this.trace.adapter.latitude] : null,
      projected: shape ? positionAlong(shape, progress)?.coordinate ?? null : null,
      predicted: shape && diagnostics ? positionAlong(shape, diagnostics.predictedProgress)?.coordinate ?? null : null,
      rendered: this.options.renderer.coordinate(vehicle.id),
      history: this.trace?.history.slice().reverse() ?? [],
    });
  }

  private updateOverlay(values?: { raw: [number, number] | null; projected: [number, number] | null; predicted: [number, number] | null; rendered: [number, number] | null; history: TransitDebugTrace['history'] }) {
    const source = this.options.map.getSource('debug-position-trace') as GeoJSONSource | undefined;
    if (!source) return;
    const features: Array<{ type: 'Feature'; properties: Record<string, string>; geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] } }> = [];
    if (values) {
      const points = [{ coordinate: values.raw, stage: 'provider', color: '#e7473c' }, { coordinate: values.projected, stage: 'projected', color: '#2584e8' }, { coordinate: values.predicted, stage: 'predicted', color: '#e8a128' }, { coordinate: values.rendered, stage: 'rendered', color: '#27a96b' }].filter((item): item is { coordinate: [number, number]; stage: string; color: string } => item.coordinate !== null);
      for (const point of points) features.push({ type: 'Feature', properties: { stage: point.stage, color: point.color }, geometry: { type: 'Point', coordinates: point.coordinate } });
      if (points.length > 1) features.unshift({ type: 'Feature', properties: { color: '#4d5960' }, geometry: { type: 'LineString', coordinates: points.map((point) => point.coordinate) } });
      const trail = values.history.slice().reverse().map((item) => [item.longitude, item.latitude] as [number, number]);
      if (trail.length > 1) features.unshift({ type: 'Feature', properties: { color: '#e7473c' }, geometry: { type: 'LineString', coordinates: trail } });
    }
    source.setData({ type: 'FeatureCollection', features });
  }

  private report() {
    const vehicle = this.current();
    return { generatedAt: new Date().toISOString(), cityId: this.options.cityId, vehicleId: this.selectedId, trace: this.trace, renderer: vehicle ? { coordinate: this.options.renderer.coordinate(vehicle.id), positionSource: this.options.renderer.positionSource(vehicle.id), diagnostics: this.options.renderer.diagnostics(vehicle.id), lod: this.options.renderer.lod, modelFallbackReason: this.options.renderer.modelFallbackReason } : null };
  }
}
