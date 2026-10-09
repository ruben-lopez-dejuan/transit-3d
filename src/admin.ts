import type { AdminCityDiagnostics, AdminCityIndex, AdminFinding, AdminProviderDiagnostics } from '../shared/transit/admin';
import type { PositionSource } from '../shared/transit/contracts';
import './admin.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
const TOKEN_KEY = 'transit-3d-admin-token';
const SOURCE_LABELS: Record<PositionSource, string> = {
  GPS: 'GPS real',
  PROVIDER_ESTIMATED: 'Estimación del proveedor',
  INTERPOLATED_REALTIME: 'Interpolado realtime',
  SCHEDULE_SIMULATION: 'Simulación horaria',
  STALE: 'Dato caducado',
};
let token = sessionStorage.getItem(TOKEN_KEY) ?? '';
let cities: AdminCityIndex[] = [];
let diagnostics: AdminCityDiagnostics | null = null;
let loading = false;
let onlyIssues = false;
let request: AbortController | null = null;

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!);
const number = (value: number) => new Intl.NumberFormat('es-ES').format(value);
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(0)} MB`;
const dateTime = (value: number | null) => value ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' }).format(value) : 'Sin dato';
function age(value: number | null) {
  if (!value) return 'sin dato';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  return `hace ${(seconds / 3600).toFixed(seconds < 10_800 ? 1 : 0)} h`;
}

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: token ? { 'X-Admin-Token': token } : {}, signal });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (response.status === 401) throw Object.assign(new Error(body.error ?? 'Se necesita el token de administración.'), { status: 401 });
  if (!response.ok) throw new Error(body.error ?? `Error HTTP ${response.status}`);
  return body as T;
}

function selectedCity() {
  const requested = new URLSearchParams(location.search).get('city');
  return cities.some((city) => city.id === requested) ? requested! : cities[0]?.id ?? '';
}

function setSelectedCity(cityId: string) {
  const url = new URL(location.href);
  url.searchParams.set('city', cityId);
  history.replaceState(null, '', url);
}

function renderShell(message = '') {
  root.innerHTML = `
    <div class="admin-shell">
      <header class="admin-header">
        <a class="admin-brand" href="/" aria-label="Volver al mapa"><span>t</span><strong>Transit 3D</strong><small>Admin</small></a>
        <div class="admin-controls">
          <label>Ciudad<select id="admin-city" ${loading ? 'disabled' : ''}>${cities.map((city) => `<option value="${escape(city.id)}" ${diagnostics?.city.id === city.id ? 'selected' : ''}>${escape(city.name)} · ${city.providers} proveedores</option>`).join('')}</select></label>
          <label class="admin-toggle"><input id="only-issues" type="checkbox" ${onlyIssues ? 'checked' : ''}> Solo incidencias</label>
          <button id="copy-json" type="button" ${diagnostics ? '' : 'disabled'}>Copiar JSON</button>
          <button id="admin-refresh" class="primary" type="button" ${loading ? 'disabled' : ''}>${loading ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
      </header>
      ${message ? `<div class="admin-message">${escape(message)}</div>` : ''}
      <main id="admin-content">${renderContent()}</main>
    </div>`;
  bindEvents();
}

function renderContent() {
  if (!diagnostics) return `<section class="admin-empty"><div class="spinner"></div><h1>Cargando diagnóstico</h1><p>Se inicializarán únicamente los datos de la ciudad seleccionada.</p></section>`;
  const visible = diagnostics.providers.filter((provider) => !onlyIssues || provider.findings.some((finding) => finding.severity !== 'info'));
  return `
    <section class="admin-intro">
      <div><p class="eyebrow">Estado operativo</p><h1>${escape(diagnostics.city.name)}</h1><p>${escape(diagnostics.city.region)} · diagnóstico generado ${age(diagnostics.generatedAt)}</p></div>
      <div class="process-stats" title="Memoria del proceso backend"><span>Backend ${Math.round(diagnostics.process.uptimeSeconds / 60)} min activo</span><span>Heap ${bytes(diagnostics.process.heapUsedBytes)} / ${bytes(diagnostics.process.heapTotalBytes)}</span><span>RSS ${bytes(diagnostics.process.rssBytes)}</span></div>
    </section>
    <section class="summary-grid">
      ${summary('Proveedores', diagnostics.totals.providers, `${diagnostics.totals.readyCatalogs} catálogos listos`)}
      ${summary('Vehículos', diagnostics.totals.vehicles, 'instantánea actual')}
      ${summary('GPS real', diagnostics.totals.gps, 'coordenadas del proveedor', 'gps')}
      ${summary('Estimados', diagnostics.totals.providerEstimated, 'proveedor o interpolación', 'estimated')}
      ${summary('Horario', diagnostics.totals.scheduled, 'simulación GTFS', 'scheduled')}
      ${summary('Incidencias', diagnostics.totals.issues, `${diagnostics.totals.stale} posiciones caducadas`, diagnostics.totals.issues ? 'problem' : 'ok')}
    </section>
    <section class="admin-legend" aria-label="Significado de la calidad"><strong>Cómo leer las posiciones</strong><span><i class="dot gps"></i>GPS: coordenada física publicada</span><span><i class="dot estimated"></i>Estimado: predicción o interpolación realtime</span><span><i class="dot scheduled"></i>Horario: simulación desde GTFS</span><span><i class="dot stale"></i>Caducado: última señal demasiado antigua</span></section>
    <section class="provider-grid">${visible.length ? visible.map(renderProvider).join('') : '<div class="admin-empty compact"><h2>No hay incidencias activas</h2><p>Desactiva el filtro para ver todos los proveedores.</p></div>'}</section>`;
}

function summary(label: string, value: number, detail: string, tone = '') {
  return `<article class="summary-card ${tone}"><span>${escape(label)}</span><strong>${number(value)}</strong><small>${escape(detail)}</small></article>`;
}

function renderProvider(provider: AdminProviderDiagnostics) {
  const positionRows = (Object.entries(provider.vehicles.byPositionSource) as [PositionSource, number][]).filter(([, count]) => count > 0);
  const capabilities = Object.entries(provider.capabilities).filter(([, enabled]) => enabled).map(([name]) => capabilityLabel(name));
  const warningCount = provider.findings.filter((finding) => finding.severity !== 'info').length;
  return `<details class="provider-card ${warningCount ? 'has-issues' : ''}" ${warningCount ? 'open' : ''}>
    <summary>
      <span class="provider-color" style="--provider-color:#${escape(provider.color.replace(/^#/, ''))}"></span>
      <span class="provider-title"><strong>${escape(provider.name)}</strong><small>${escape(provider.id)}${provider.group ? ` · ${escape(provider.group)}` : ''}</small></span>
      <span class="status ${escape(provider.status)}">${statusLabel(provider.status)}</span>
      <span class="provider-total"><strong>${number(provider.vehicles.total)}</strong><small>vehículos</small></span>
      <span class="chevron">⌄</span>
    </summary>
    <div class="provider-body">
      <section class="diagnostic-block"><h3>Catálogo GTFS</h3><div class="catalog-state ${escape(provider.catalog.state)}">${catalogLabel(provider.catalog.state)}</div><dl class="metric-list"><div><dt>Rutas</dt><dd>${number(provider.catalog.routes)}</dd></div><div><dt>Viajes</dt><dd>${number(provider.catalog.trips)}</dd></div><div><dt>Paradas</dt><dd>${number(provider.catalog.stops)}</dd></div><div><dt>Shapes</dt><dd>${number(provider.catalog.shapes)}</dd></div><div><dt>Servicios</dt><dd>${number(provider.catalog.services)}</dd></div></dl></section>
      <section class="diagnostic-block"><h3>Posiciones actuales</h3>${positionRows.length ? `<ul class="source-list">${positionRows.map(([source, count]) => `<li><span><i class="dot ${sourceTone(source)}"></i>${SOURCE_LABELS[source]}</span><strong>${number(count)}</strong></li>`).join('')}</ul>` : '<p class="muted">No hay posiciones en la instantánea.</p>'}<div class="inline-metrics"><span>Trip updates <strong>${number(provider.realtimeTripCount)}</strong></span><span>Llegadas realtime <strong>${number(provider.realtimeArrivalCount)}</strong></span></div></section>
      <section class="diagnostic-block timestamps"><h3>Tiempos</h3>${timestampRow('Dato de la fuente', provider.timestamps.source)}${timestampRow('Recibido por backend', provider.timestamps.received)}${timestampRow('Última comprobación', provider.timestamps.checked)}${timestampRow('Último éxito', provider.timestamps.lastSuccess)}</section>
      <section class="diagnostic-block"><h3>Capacidades declaradas</h3><div class="tag-list">${capabilities.length ? capabilities.map((item) => `<span>${escape(item)}</span>`).join('') : '<span>Solo catálogo</span>'}</div></section>
      <section class="diagnostic-block findings"><h3>Diagnóstico</h3>${provider.findings.length ? provider.findings.map(renderFinding).join('') : '<p class="finding ok"><b>✓</b><span>Sin incidencias detectadas.</span></p>'}${provider.error ? `<pre>${escape(provider.error)}</pre>` : ''}</section>
      ${provider.samples.length ? `<section class="diagnostic-block samples"><h3>Muestra de vehículos</h3><div class="table-wrap"><table><thead><tr><th>Línea</th><th>Destino</th><th>Origen</th><th>Dato fuente</th></tr></thead><tbody>${provider.samples.map((sample) => `<tr><td><strong>${escape(sample.route || '—')}</strong></td><td>${escape(sample.destination || '—')}</td><td>${escape(SOURCE_LABELS[sample.positionSource])}</td><td title="${escape(dateTime(sample.sourceTimestamp))}">${escape(age(sample.sourceTimestamp))}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    </div>
  </details>`;
}

function renderFinding(finding: AdminFinding) {
  const icon = finding.severity === 'error' ? '×' : finding.severity === 'warning' ? '!' : 'i';
  return `<p class="finding ${escape(finding.severity)}"><b>${icon}</b><span>${escape(finding.message)}<small>${escape(finding.code)}</small></span></p>`;
}

function timestampRow(label: string, value: number | null) {
  return `<div class="timestamp-row"><span>${escape(label)}</span><strong title="${escape(dateTime(value))}">${escape(age(value))}</strong></div>`;
}

function capabilityLabel(value: string) {
  return ({ staticGtfs: 'GTFS', vehiclePositions: 'Posiciones', tripUpdates: 'Trip updates', serviceAlerts: 'Alertas', occupancy: 'Ocupación', speed: 'Velocidad', bearing: 'Orientación', stopArrivals: 'Llegadas', scheduledService: 'Servicio horario' } as Record<string, string>)[value] ?? value;
}
function statusLabel(value: AdminProviderDiagnostics['status']) { return ({ ok: 'Correcto', degraded: 'Degradado', stale: 'Caducado', unavailable: 'No disponible', not_checked: 'Sin comprobar' })[value]; }
function catalogLabel(value: AdminProviderDiagnostics['catalog']['state']) { return ({ ready: 'Listo', loading: 'Cargando', error: 'Error', disabled: 'Desactivado' })[value]; }
function sourceTone(value: PositionSource) { return value === 'GPS' ? 'gps' : value === 'SCHEDULE_SIMULATION' ? 'scheduled' : value === 'STALE' ? 'stale' : 'estimated'; }

function bindEvents() {
  document.querySelector<HTMLSelectElement>('#admin-city')?.addEventListener('change', (event) => {
    setSelectedCity((event.currentTarget as HTMLSelectElement).value);
    diagnostics = null;
    void loadDiagnostics();
  });
  document.querySelector<HTMLInputElement>('#only-issues')?.addEventListener('change', (event) => { onlyIssues = (event.currentTarget as HTMLInputElement).checked; renderShell(); });
  document.querySelector('#admin-refresh')?.addEventListener('click', () => void loadDiagnostics());
  document.querySelector('#copy-json')?.addEventListener('click', async () => {
    if (!diagnostics) return;
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    renderShell('Diagnóstico copiado al portapapeles.');
  });
}

function renderToken(error: string) {
  root.innerHTML = `<div class="token-screen"><form id="token-form"><span class="admin-logo">t</span><h1>Consola de administración</h1><p>${escape(error)}</p><label>Token<input id="token" type="password" autocomplete="current-password" required autofocus></label><button class="primary" type="submit">Entrar</button><a href="/">Volver al mapa</a></form></div>`;
  document.querySelector<HTMLFormElement>('#token-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    token = document.querySelector<HTMLInputElement>('#token')!.value;
    sessionStorage.setItem(TOKEN_KEY, token);
    void start();
  });
}

async function loadDiagnostics() {
  const cityId = selectedCity();
  if (!cityId || loading) return;
  request?.abort();
  request = new AbortController();
  loading = true;
  renderShell();
  try {
    diagnostics = await api<AdminCityDiagnostics>(`/api/admin/cities/${encodeURIComponent(cityId)}`, request.signal);
    loading = false;
    renderShell();
  } catch (error) {
    loading = false;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if ((error as { status?: number }).status === 401) { sessionStorage.removeItem(TOKEN_KEY); token = ''; renderToken(error instanceof Error ? error.message : String(error)); return; }
    renderShell(error instanceof Error ? error.message : String(error));
  }
}

async function start() {
  document.title = 'Admin · Transit 3D';
  try {
    cities = await api<AdminCityIndex[]>('/api/admin/cities');
    if (!cities.length) { renderShell('No hay ciudades registradas.'); return; }
    setSelectedCity(selectedCity());
    await loadDiagnostics();
  } catch (error) {
    if ((error as { status?: number }).status === 401) renderToken(error instanceof Error ? error.message : String(error));
    else renderShell(error instanceof Error ? error.message : String(error));
  }
}

setInterval(() => { if (!document.hidden && !loading && diagnostics) void loadDiagnostics(); }, 30_000);
void start();
