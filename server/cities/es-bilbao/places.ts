import type { Stop } from '../../../shared/transit/network';
import { distanceMeters } from '../../transit/motionEngine';
/** Existing shortcuts, resolved from official station coordinates. */
export function placeShortcuts(stops: Stop[]) {
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return ['Moyua', 'San Mamés', 'Plentzia', 'Aeropuerto', 'Guggenheim', 'Abando', 'Casco Viejo', 'Donostia', 'Vitoria-Gasteiz'].flatMap((name) => {
    const term = fold(name);
    const candidates = stops.filter((s) => fold(s.name).includes(term) || (name === 'Moyua' && /eliptikoa/i.test(s.name)) || (name === 'Vitoria-Gasteiz' && /angulema/i.test(s.name)) || (name === 'Donostia' && /amara/i.test(s.name)) || (name === 'Aeropuerto' && /aireportu/i.test(s.name)));
    const rank = (s: Stop) => (fold(s.name) === term ? 0 : 2) + (s.modes.includes('rail') || s.modes.includes('tram') ? 0 : 1);
    candidates.sort((a, b) => rank(a) - rank(b) || distanceMeters([a.longitude, a.latitude], [-2.935, 43.263]) - distanceMeters([b.longitude, b.latitude], [-2.935, 43.263]));
    const stop = candidates[0];
    return stop ? [{ id: name, name, longitude: stop.longitude, latitude: stop.latitude }] : [];
  });
}
