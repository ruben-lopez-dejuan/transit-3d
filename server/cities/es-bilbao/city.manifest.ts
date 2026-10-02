import { CITY_PACKAGE_API_VERSION, type CityManifest, type ProviderCapabilities, type ProviderDefinition } from '../../../shared/transit/contracts';
import { primary, regionalSources, renfeSource } from './sources';
const capabilities = (overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({ staticGtfs: true, vehiclePositions: false, tripUpdates: false, serviceAlerts: false, occupancy: false, speed: false, bearing: false, stopArrivals: false, ...overrides });
const definitions: ProviderDefinition[] = [
  ...primary.map((s) => ({ id: s.id, name: s.name, color: s.color, realtime: true, primary: true, capabilities: capabilities({ tripUpdates: true }), ...(s.id === 'euskotren' ? { layers: [{ name: 'Euskotren · tren', mode: 'rail' as const }, { name: 'Tranvía · Bilbao / Vitoria', mode: 'tram' as const }] } : {}) })),
  { id: renfeSource.id, name: renfeSource.name, color: renfeSource.color, realtime: true, primary: true, capabilities: capabilities({ vehiclePositions: true, tripUpdates: true }) },
  { id: 'bizkaibus', name: 'Bizkaibus', color: '#177857', realtime: true, primary: true, capabilities: capabilities({ vehiclePositions: true, tripUpdates: true }) },
  { id: 'bilbobus', name: 'Bilbobus', color: '#c33b42', realtime: true, primary: true, capabilities: capabilities({ vehiclePositions: true, stopArrivals: true, speed: true }) },
  ...regionalSources.map((s) => ({ id: s.id, name: s.name, color: s.color, realtime: !!s.tripUpdates || !!s.vehiclePositions, primary: s.id === 'funicular-artxanda', group: s.name.includes('Lurraldebus') ? 'Lurraldebus' : 'Otros', capabilities: capabilities({ vehiclePositions: !!s.vehiclePositions, tripUpdates: !!s.tripUpdates }) })),
];
export const bilbaoManifest: CityManifest = {
  id: 'es-bilbao', countryCode: 'ES', name: 'Bilbao', region: 'Bizkaia / Euskadi', timezone: 'Europe/Madrid',
  center: [-2.949, 43.277], bounds: [[-3.5, 42.5], [-1.6, 43.65]], providers: definitions,
  modes: ['bus', 'rail', 'tram', 'funicular', 'unknown'], apiVersion: CITY_PACKAGE_API_VERSION,
  presentation: { title: 'Bilbao Transit', mapLabel: 'Mapa del transporte de Bilbao y Bizkaia', searchLabel: 'Explora Bilbao y Bizkaia', initialZoom: 12.45, brandMark: 'b.' },
};
