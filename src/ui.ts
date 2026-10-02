import type { Departure, Vehicle, Route } from './transit/networkTypes';

export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const time = (at: number) => new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
export const eta = (at: number) => { const minutes = Math.ceil((at - Date.now()) / 60000); return minutes <= 0 ? 'Ahora' : minutes < 60 ? `${minutes} min` : time(at); };
export const qualityName = { live: 'GPS reciente', predicted: 'Estimada', scheduled: 'Horario' };
export const quality = (q: keyof typeof qualityName) => `<span class="quality ${q}"><i></i>${qualityName[q]}</span>`;
export const badge = (route: Pick<Route, 'color' | 'shortName'> | Pick<Vehicle, 'color' | 'label'>) => {
  const color = /^#[0-9a-f]{6}$/i.test(route.color) ? route.color : '#176955';
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return `<span class="line-badge" style="--line:${color};--line-text:${luminance > .179 ? '#152c26' : '#ffffff'}">${esc('label' in route ? route.label : route.shortName)}</span>`;
};
export const delayLabel = (seconds: number) => Math.abs(seconds) < 30 ? 'En hora' : `${seconds < 0 ? '−' : '+'}${Math.round(Math.abs(seconds) / 60)} min`;
export function positionExplanation(v: Vehicle, now = Date.now()) {
  if (v.positionQuality === 'scheduled') return 'Posición calculada con el horario. No es una ubicación GPS.';
  if (v.observationTimestamp !== null) return `Último GPS hace ${Math.max(0, Math.floor((now - v.observationTimestamp) / 1000))} s. El movimiento entre lecturas es estimado.`;
  return `Posición estimada con horarios actualizados por el operador${v.timetableTimestamp ? ` hace ${Math.max(0, Math.floor((now - v.timetableTimestamp) / 1000))} s` : ''}.`;
}
export const departures = (items: Departure[], operatorName: (id: string) => string, now = Date.now()) => items.length ? `<div class="departures">${items.map((d) => {
  const expired = !!d.updatedAt && now - d.updatedAt > 180_000;
  const realtime = d.source === 'realtime' && !expired, canceled = !!d.canceled && !expired;
  const at = expired ? d.scheduledAt ?? d.at : d.at;
  const source = realtime ? 'Tiempo real' : d.source === 'gps' && !expired ? 'Estimado por GPS' : 'Horario';
  const freshness = !expired && d.updatedAt ? `Actualizado hace ${Math.max(0, Math.floor((now - d.updatedAt) / 1000))} s` : expired ? 'Sin actualización reciente' : '';
  return `<button class="departure row ${realtime ? 'realtime' : ''} ${canceled ? 'canceled' : ''}" data-route="${esc(d.routeKey)}"><span class="departure-line">${esc(d.label)}</span><span class="row-copy"><strong>${esc(d.headsign || 'Servicio programado')}</strong><small>${esc(operatorName(d.operatorId))} · <span class="departure-source">${source}</span>${realtime && !canceled && d.delaySeconds !== null ? ` · ${delayLabel(d.delaySeconds)}` : ''}</small>${freshness ? `<small class="departure-freshness">${freshness}</small>` : ''}</span><span class="arrival"><strong>${canceled ? 'Cancelado' : eta(at)}</strong><small>${!canceled && realtime && d.scheduledAt && Math.abs(at - d.scheduledAt) >= 30_000 ? `<s>${time(d.scheduledAt)}</s> → ` : ''}${time(at)}</small></span></button>`;
}).join('')}</div>` : '<p class="empty-copy">Sin próximos servicios en las siguientes seis horas.</p>';
export const shell = `<div id="map" aria-label="Mapa del transporte de Bilbao y Bizkaia"></div>
<header class="brand"><span class="brand-mark">b.</span><div><strong>Bilbao Transit</strong><span>La ciudad en movimiento</span></div></header>
<section class="search-shell" aria-label="Buscar transporte"><div class="search-bar"><span aria-hidden="true">⌕</span><input id="search" type="search" autocomplete="off" placeholder="Línea, parada o estación" aria-label="Buscar línea, parada o estación" role="combobox" aria-controls="results" aria-expanded="false"><button id="clear-search" aria-label="Borrar búsqueda" hidden>×</button><kbd>/</kbd></div><div id="search-results" hidden><div class="search-heading">Explora la red</div><div id="results" role="listbox"></div><p class="search-foot">Líneas, paradas y lugares de la red de transporte</p></div></section>
<nav class="mode-nav" aria-label="Filtrar por transporte"><button data-mode="all" class="active" aria-pressed="true"><span>◉</span>Todos</button><button data-mode="bus" aria-pressed="false"><span>▣</span>Bus</button><button data-mode="rail" aria-pressed="false"><span>▥</span>Metro / tren</button><button data-mode="tram" aria-pressed="false"><span>▤</span>Tranvía</button></nav>
<div class="top-actions"><button id="layers-button" class="surface-button" aria-expanded="false" aria-controls="layers"><span>☷</span> Capas</button></div>
<section id="layers" class="floating-panel" hidden aria-label="Capas y apariencia"><div class="popover-title"><strong>Operadores</strong><button data-close-layers aria-label="Cerrar capas">×</button></div><div id="operator-list"></div><div class="theme-row"><label for="theme">Apariencia</label><select id="theme"><option value="system">Sistema</option><option value="light">Clara</option><option value="dark">Oscura</option></select></div><div class="legend"><strong>Cómo leer el mapa</strong><p>${quality('live')} Posición GPS reciente</p><p>${quality('predicted')} Movimiento estimado con GPS o horarios realtime</p><p>${quality('scheduled')} Movimiento según el horario</p><small>Las llegadas «Tiempo real» están actualizadas por el operador. Una posición estimada no es una ubicación GPS.</small></div><button id="refresh" class="text-button">↻ Actualizar datos</button></section>
<aside id="details" class="detail-panel" hidden aria-label="Información de transporte"><button id="sheet-handle" class="sheet-handle" aria-label="Expandir o reducir panel"><span></span></button><div class="detail-toolbar"><button id="back" class="text-button" aria-label="Volver a la línea">← Volver</button><button id="favorite" aria-label="Guardar favorito" aria-pressed="false">☆</button><button id="close-details" aria-label="Cerrar información">×</button></div><div id="detail-content" aria-live="polite"></div></aside>
<div class="map-controls"><button id="locate" aria-label="Mi ubicación" title="Mi ubicación">⌖</button><div class="control-group"><button id="zoom-in" aria-label="Acercar">+</button><button id="zoom-out" aria-label="Alejar">−</button></div><button id="north" aria-label="Orientar al norte" title="Orientar al norte">N ↑</button><button id="perspective" aria-label="Activar vista 3D" aria-pressed="false">3D</button></div>
<div class="map-status" role="status"><span class="status-dot"></span><span id="status">Cargando la red de transporte…</span></div><div id="empty-map" hidden></div><div id="toast" role="status" hidden></div><pre id="debug" hidden></pre>`;
