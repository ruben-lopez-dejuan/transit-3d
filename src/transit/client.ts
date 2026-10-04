import type { Network, Snapshot, Shape, LineDetail, StopDetail, TripDetail, Vehicle, Route, Stop } from "./networkTypes";
import { CITY_PACKAGE_API_VERSION, type CityManifest } from '../../shared/transit/contracts';
let cityId: string | null = null;
const inCity = (url: string) => cityId ? url + (url.includes('?') ? '&' : '?') + 'cityId=' + encodeURIComponent(cityId) : url;
export const loadCities = () => request<CityManifest[]>('/api/cities', { timeoutMs: 8_000 });
export async function loadCity(id?: string) {
  const city = await request<CityManifest>(id ? '/api/cities/' + encodeURIComponent(id) : '/api/cities/default', { timeoutMs: 8_000 });
  if (city.apiVersion !== CITY_PACKAGE_API_VERSION) throw new Error('Versión de la ciudad incompatible. Recarga la aplicación.');
  cityId = city.id;
  return city;
}

type RequestOptions = RequestInit & { timeoutMs?: number };
async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 12_000, ...init } = options;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetch(url, { ...init, signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "El servicio no está disponible. Inténtalo de nuevo.");
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('El servidor ha tardado demasiado en responder. Reintenta la actualización desde Capas.');
    }
    throw error;
  }
}
export const loadNetwork = () => request<Network>(inCity('/api/network'), { timeoutMs: 20_000 });
export const loadSnapshot = () => request<Snapshot>(inCity('/api/transit'), { cache: 'no-store', timeoutMs: 12_000 });
export const loadShapes = (keys: string[], signal?: AbortSignal) => request<Shape[]>(inCity('/api/geometries'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }), signal, timeoutMs: 15_000 });
export const loadLine = (route: Route, direction = 'all', signal?: AbortSignal) => request<LineDetail>(inCity(`/api/lines/${encodeURIComponent(route.operatorId)}/${encodeURIComponent(route.externalId)}?direction=${encodeURIComponent(direction)}`), { cache: 'no-store', signal, timeoutMs: 10_000 });
export const loadStop = (stop: Stop, signal?: AbortSignal) => request<StopDetail>(inCity(`/api/stops/${encodeURIComponent(stop.operatorId)}/${encodeURIComponent(stop.externalId)}`), { cache: 'no-store', signal, timeoutMs: 10_000 });
export const loadTrip = (vehicle: Vehicle, signal?: AbortSignal) => request<TripDetail>(inCity(`/api/trips/${encodeURIComponent(vehicle.operatorId)}/${encodeURIComponent(vehicle.externalTripId)}?date=${vehicle.serviceDate}&vehicleId=${encodeURIComponent(vehicle.id)}`), { cache: 'no-store', signal, timeoutMs: 10_000 });
