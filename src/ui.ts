import { isFresh } from '../shared/transit/freshness';
import { arrivalReliability, RELIABILITY_LABELS, vehicleReliability, type ReliabilityLevel } from '../shared/transit/reliability';
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
export const departures = (items: Departure[], operatorName: (id: string) => string, now = Date.now()) => items.length ? `<div class="departures">${items.map((d) => {
  const reliability = arrivalReliability(d.source, d.updatedAt, now);
  const expired = !!d.updatedAt && !isFresh(d.updatedAt, now);
  const realtime = reliability.basis === 'realtime', canceled = !!d.canceled && !expired;
  const at = expired ? d.scheduledAt ?? d.at : d.at;
  const freshness = !expired && d.updatedAt ? `Actualizado hace ${Math.max(0, Math.floor((now - d.updatedAt) / 1000))} s` : expired ? 'Sin actualización reciente' : '';
  return `<button class="departure row ${realtime ? 'realtime' : ''} ${canceled ? 'canceled' : ''}" data-route="${esc(d.routeKey)}"><span class="departure-line">${esc(d.label)}</span><span class="row-copy"><strong>${esc(d.headsign || 'Servicio programado')}</strong><small>${esc(operatorName(d.operatorId))} · ${reliabilityBadge(reliability.level)}${realtime && !canceled && d.delaySeconds !== null ? ` · ${delayLabel(d.delaySeconds)}` : ''}</small>${freshness ? `<small class="departure-freshness">${freshness}</small>` : ''}</span><span class="arrival"><strong>${canceled ? 'Cancelado' : eta(at)}</strong><small>${!canceled && realtime && d.scheduledAt && Math.abs(at - d.scheduledAt) >= 30_000 ? `<s>${time(d.scheduledAt)}</s> → ` : ''}${time(at)}</small></span></button>`;
}).join('')}</div>` : '<p class="empty-copy">Sin próximos servicios en las siguientes seis horas.</p>';
export const createShell = (city: CityManifest, cities: readonly CityManifest[] = [city]) => `<div id="map" aria-label="${esc(city.presentation.mapLabel)}"></div>
<header class="brand"><span class="brand-mark">${esc(city.presentation.brandMark)}</span><div><strong>${esc(city.presentation.title)}</strong><select id="city-picker" aria-label="Ciudad o núcleo urbano" title="Cambiar ciudad o núcleo urbano">${cities.map((candidate) => `<option value="${esc(candidate.id)}" ${candidate.id === city.id ? 'selected' : ''}>${esc(candidate.name)}</option>`).join('')}</select></div></header>
<section class="search-shell" aria-label="Buscar transporte"><div class="search-bar"><span aria-hidden="true">⌕</span><input id="search" type="search" autocomplete="off" placeholder="Línea, parada o estación" aria-label="Buscar línea, parada o estación" role="combobox" aria-controls="results" aria-expanded="false"><button id="clear-search" aria-label="Borrar búsqueda" hidden>×</button><kbd>/</kbd></div><div id="search-results" hidden><div class="search-heading">Explora la red</div><div id="results" role="listbox"></div><p class="search-foot">Líneas, paradas y lugares de la red de transporte</p></div></section>
<nav class="mode-nav" aria-label="Filtrar por transporte"><button data-mode="all" class="active" aria-pressed="true"><span>◉</span>Todos</button><button data-mode="bus" aria-pressed="false"><span>▣</span>Bus</button><button data-mode="rail" aria-pressed="false"><span>▥</span>Metro / tren</button><button data-mode="tram" aria-pressed="false"><span>▤</span>Tranvía</button><button data-mode="funicular" aria-pressed="false"><span>↗</span>Funicular</button></nav>
<div class="top-actions"><button id="layers-button" class="surface-button" aria-expanded="false" aria-controls="layers"><span>☷</span> Capas</button></div>
<section id="layers" class="floating-panel" hidden aria-label="Capas y apariencia"><div class="popover-title"><strong>Operadores</strong><button data-close-layers aria-label="Cerrar capas">×</button></div><div id="operator-list"></div><label class="operator-row"><input id="underground" type="checkbox" checked><span>Ver Metro subterráneo<small>Representación transparente · profundidad aproximada</small></span></label><div class="theme-row"><label for="theme">Apariencia</label><select id="theme"><option value="system">Sistema</option><option value="light">Clara</option><option value="dark">Oscura</option></select></div><div class="legend"><strong>Cómo leer el mapa</strong><p>${reliabilityBadge('high')} Datos actuales del operador: GPS del vehículo o llegadas previstas en tiempo real</p><p>${reliabilityBadge('medium')} Estimación con datos actuales parciales</p><p>${reliabilityBadge('low')} Sin datos en tiempo real: según el horario previsto</p><small>Lo mismo vale para posiciones y horas de llegada. El detalle de cada vehículo explica de dónde sale su posición.</small></div><button id="refresh" class="text-button">↻ Actualizar datos</button></section>
<aside id="details" class="detail-panel" hidden aria-label="Información de transporte"><button id="sheet-handle" class="sheet-handle" aria-label="Reducir panel" aria-expanded="true" aria-controls="detail-content"><span></span></button><div class="detail-toolbar"><button id="back" class="text-button" aria-label="Volver a la línea">← Volver</button><button id="favorite" aria-label="Guardar favorito" aria-pressed="false">☆</button><button id="close-details" aria-label="Cerrar información">×</button></div><div id="detail-content" aria-live="polite"></div></aside>
<div class="map-controls"><button id="locate" aria-label="Mi ubicación" title="Mi ubicación">⌖</button><div class="control-group"><button id="zoom-in" aria-label="Acercar">+</button><button id="zoom-out" aria-label="Alejar">−</button></div><button id="north" aria-label="Orientar al norte" title="Orientar al norte">N ↑</button><button id="perspective" aria-label="Activar vista 3D" aria-pressed="false">3D</button></div>
<div class="map-status" role="status"><span class="status-dot"></span><span id="status">Cargando la red de transporte…</span></div><div id="empty-map" hidden></div><div id="toast" role="status" hidden></div><pre id="debug" hidden></pre>`;
