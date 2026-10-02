// Some GTFS headsigns contain a service-calendar prefix around the destination.
// Preserve other headsigns verbatim; this is presentation cleanup, not routing.
import type { Stop } from '../../src/transit/networkTypes';
import { distanceMeters } from './motionEngine';

export function passengerHeadsign(value: string, fallback = value): string {
  const destination = /^PT-[^/]+\/\s*\(([^)]+)\)/i.exec(value.trim());
  return destination?.[1].trim() || (/^PT-[A-Z0-9-]+$/i.test(value.trim()) ? fallback : value);
}

export function placeShortcuts(stops: Stop[]) {
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return ['Moyua', 'San Mamés', 'Plentzia', 'Aeropuerto', 'Guggenheim', 'Abando', 'Casco Viejo'].flatMap((name) => {
    const term = fold(name);
    const candidates = stops.filter((s) => fold(s.name).includes(term) || (name === 'Aeropuerto' && /aireportu/i.test(s.name)));
    const rank = (s: Stop) => (fold(s.name) === term ? 0 : 2) + (s.modes.includes('rail') || s.modes.includes('tram') ? 0 : 1);
    // Resolve similarly named suburban stops to the exact station near central Bilbao.
    candidates.sort((a, b) => rank(a) - rank(b) || distanceMeters([a.longitude, a.latitude], [-2.935, 43.263]) - distanceMeters([b.longitude, b.latitude], [-2.935, 43.263]));
    const stop = candidates[0];
    return stop ? [{ id: name, name, longitude: stop.longitude, latitude: stop.latitude }] : [];
  });
}
