import { isFresh } from '../shared/transit/freshness';
import { arrivalReliability, RELIABILITY_LABELS, vehicleReliability, type ReliabilityLevel } from '../shared/transit/reliability';
import { icon } from './icons';
import type { Departure, Vehicle, Route } from './transit/networkTypes';
import type { CityManifest } from '../shared/transit/contracts';

export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let timezone = 'UTC';
export function configureTimezone(value: string) { new Intl.DateTimeFormat('es', { timeZone: value }); timezone = value; }
export const time = (at: number) => new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
export const eta = (at: number, now = Date.now()) => { const minutes = Math.ceil((at - now) / 60000); return minutes <= 0 ? 'Ahora' : minutes < 60 ? `${minutes} min` : time(at); };
const RELIABILITY_HINTS: Record<ReliabilityLevel, string> = { high: 'Datos actuales del operador', medium: 'Estimación con datos actuales parciales', low: 'Según el horario previsto' };
/** One public trust level, whatever produced the position or time. */
export const reliabilityBadge = (level: ReliabilityLevel) => `<span class="reliability ${level}" title="${RELIABILITY_HINTS[level]}"><i></i>${RELIABILITY_LABELS[level]}</span>`;
export const badge = (route: Pick<Route, 'color' | 'shortName'> | Pick<Vehicle, 'color' | 'label'>) => {
  const color = /^#[0-9a-f]{6}$/i.test(route.color) ? route.color : '#176955';
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return `<span class="line-badge" style="--line:${color};--line-text:${luminance > .179 ? '#152c26' : '#ffffff'}">${esc('label' in route ? route.label : route.shortName)}</span>`;
};
/** The next stop is still ahead of the vehicle, so a forecast time already gone means it is about to arrive. */
export const arrivalLabel = (at: number, now = Date.now()) => at <= now ? 'Llegando' : eta(at, now);
/** Within this of the drawn bus, a due stop really is being reached. */
const ARRIVING_METERS = 150;
/**
 * The arrival time to show for the next stop, consistent with where the bus is drawn. An
 * operator's real-time time is shown as is: at 0 minutes the map also puts the bus at the stop.
 * An estimated time already due while the bus is still drawn far away would say "Llegando" for
 * a bus that visibly is not; it becomes the time to cover that distance at the drawn speed.
 */
export function consistentArrival(at: number, now: number, official: boolean, metersAhead: number | null, speed: number) {
  if (official || at > now || metersAhead === null || metersAhead <= ARRIVING_METERS) return at;
  return now + metersAhead / Math.max(speed, 4) * 1000;
}
export const delayLabel = (seconds: number) => Math.abs(seconds) < 30 ? 'En hora' : `${seconds < 0 ? '−' : '+'}${Math.round(Math.abs(seconds) / 60)} min`;
export function positionExplanation(v: Vehicle, now = Date.now()) {
  const reliability = vehicleReliability(v, now);
  const seconds = reliability.ageMs === null ? null : Math.floor(reliability.ageMs / 1000);
  const ago = seconds === null ? '' : seconds < 120 ? `hace ${seconds} s` : `hace ${Math.floor(seconds / 60)} min`;
  // The badge above already gives the level; this line only says what the position rests on and how old it is.
  const identity = reliability.identityEstimated ? ' · servicio sin confirmar' : '';
  if (reliability.basis === 'schedule') return 'Sin datos en tiempo real';
  if (reliability.level === 'low') return ago ? `Último dato ${ago}` : 'Sin datos recientes';
  if (reliability.basis === 'gps') return `GPS ${ago}${identity}`;
  return `Sin GPS · previsión ${ago || 'del operador'}`;
}
export const departures = (items: Departure[], operatorName: (id: string) => string, now = Date.now()) => items.length ? `<div class="departures">${items.map((d, _, all) => {
  // The operator only tells services apart where several share the stop.
  const operator = all.some((other) => other.operatorId !== d.operatorId) ? `${esc(operatorName(d.operatorId))} · ` : '';
  const reliability = arrivalReliability(d.source, d.updatedAt, now);
  const expired = !!d.updatedAt && !isFresh(d.updatedAt, now);
  const realtime = reliability.basis === 'realtime', canceled = !!d.canceled && !expired;
  const at = expired ? d.scheduledAt ?? d.at : d.at;
  const shifted = !canceled && realtime && !!d.scheduledAt && Math.abs(at - d.scheduledAt) >= 30_000;
  const freshness = !expired && d.updatedAt ? `Actualizado hace ${Math.max(0, Math.floor((now - d.updatedAt) / 1000))} s` : expired ? 'Sin actualización reciente' : '';
  return `<button class="departure row ${realtime ? 'realtime' : ''} ${canceled ? 'canceled' : ''}" data-route="${esc(d.routeKey)}"${freshness && !expired ? ` title="${freshness}"` : ''}><span class="departure-line">${esc(d.label)}</span><span class="row-copy"><strong>${esc(d.headsign || 'Servicio programado')}</strong><small>${operator}${reliabilityBadge(reliability.level)}${realtime && !canceled && d.delaySeconds !== null ? ` · ${delayLabel(d.delaySeconds)}` : ''}</small>${expired ? `<small class="departure-freshness">${freshness}</small>` : ''}</span><span class="arrival"><strong>${canceled ? 'Cancelado' : eta(at)}</strong>${canceled || eta(at) !== time(at) || shifted ? `<small>${shifted ? `<s>${time(d.scheduledAt!)}</s> → ` : ''}${time(at)}</small>` : ''}</span></button>`;
}).join('')}</div>` : '<p class="empty-copy">Sin próximos servicios en las siguientes seis horas.</p>';
export const createShell = (city: CityManifest, cities: readonly CityManifest[] = [city]) => `<div id="map" aria-label="${esc(city.presentation.mapLabel)}"></div>
<header class="brand"><span class="brand-mark">${esc(city.presentation.brandMark)}</span><div><strong>${esc(city.presentation.title)}</strong><select id="city-picker" aria-label="Ciudad o núcleo urbano" title="Cambiar ciudad o núcleo urbano">${cities.map((candidate) => `<option value="${esc(candidate.id)}" ${candidate.id === city.id ? 'selected' : ''}>${esc(candidate.name)}</option>`).join('')}</select></div></header>
<section class="search-shell" aria-label="Buscar transporte"><div class="search-bar"><span aria-hidden="true">⌕</span><input id="search" type="search" autocomplete="off" placeholder="Línea, parada o estación" aria-label="Buscar línea, parada o estación" role="combobox" aria-controls="results" aria-expanded="false"><button id="clear-search" aria-label="Borrar búsqueda" hidden>×</button><kbd>/</kbd></div><div id="search-results" hidden><div class="search-heading">Explora la red</div><div id="results" role="listbox"></div></div></section>
<nav class="mode-nav" aria-label="Filtrar por transporte"><button data-mode="all" class="active" aria-pressed="true">${icon('all')}Todos</button><button data-mode="bus" aria-pressed="false">${icon('bus')}Bus</button><button data-mode="rail" aria-pressed="false">${icon('metro')}Metro / tren</button><button data-mode="tram" aria-pressed="false">${icon('tram')}Tranvía</button><button data-mode="funicular" aria-pressed="false">${icon('funicular')}Funicular</button></nav>
<div class="top-actions"><button id="layers-button" class="surface-button" aria-expanded="false" aria-controls="layers">${icon('layers')} Capas</button></div>
<section id="layers" class="floating-panel" hidden aria-label="Capas y apariencia"><div class="popover-title"><strong>Capas</strong><button data-close-layers aria-label="Cerrar capas">×</button></div><h3 class="panel-label">Operadores</h3><div id="operator-list"></div><h3 class="panel-label">Vista</h3><label class="operator-row option-row"><input id="underground" type="checkbox" checked><span><strong>Bajo tierra</strong><small>Metro y trenes dentro de los túneles</small></span></label><button id="zen-layers" class="zen-row">${icon('zen')}<span><strong>Modo zen</strong><small>Solo el transporte en movimiento</small></span><kbd>Z</kbd></button><div class="theme-row"><label for="theme">Apariencia</label><select id="theme"><option value="system">Sistema</option><option value="light">Clara</option><option value="dark">Oscura</option></select></div><div class="legend"><h3 class="panel-label">Cómo leer el mapa</h3><p>${reliabilityBadge('high')}<span>GPS o llegadas del operador al momento</span></p><p>${reliabilityBadge('medium')}<span>Estimado con datos parciales</span></p><p>${reliabilityBadge('low')}<span>Sin datos en tiempo real, según el horario</span></p></div><button id="refresh" class="text-button">↻ Actualizar datos</button></section>
<aside id="details" class="detail-panel" hidden aria-label="Información de transporte"><button id="sheet-handle" class="sheet-handle" aria-label="Reducir panel" aria-expanded="true" aria-controls="detail-content"><span></span></button><div class="detail-toolbar"><button id="back" class="text-button" hidden>← Volver al vehículo</button><button id="favorite" aria-label="Guardar favorito" aria-pressed="false">☆</button><button id="close-details" aria-label="Cerrar información">×</button></div><div id="detail-content" aria-live="polite"></div></aside>
<div class="map-controls"><div class="control-group"><button id="locate" aria-label="Mi ubicación" title="Mi ubicación">${icon('locate')}</button></div><div class="control-group zoom-group"><button id="zoom-in" aria-label="Acercar" title="Acercar">+</button><button id="zoom-out" aria-label="Alejar" title="Alejar">−</button></div><div class="control-group"><button id="north" aria-label="Orientar al norte" title="Orientar al norte">${icon('north')}</button><button id="perspective" aria-label="Activar vista 3D" title="Vista 3D" aria-pressed="false">3D</button><button id="zen" aria-label="Modo zen: ocultar etiquetas e interfaz" title="Modo zen (Z)">${icon('zen')}</button></div></div>
<button id="zen-exit" class="zen-exit" hidden>${icon('exit')}<span>Salir del modo zen</span><kbd>Esc</kbd></button>
<div class="map-status" role="status"><span class="status-dot"></span><span id="status">Cargando la red de transporte…</span></div><div id="empty-map" hidden></div><div id="toast" role="status" hidden></div><pre id="debug" hidden></pre>`;
