import type { Network, Snapshot, Shape, LineDetail, StopDetail, TripDetail, Vehicle, Route, Stop } from "./networkTypes";
import { CITY_PACKAGE_API_VERSION, type CityManifest } from '../../shared/transit/contracts';
let cityId: string | null = null;
const inCity = (url: string) => cityId ? url + (url.includes('?') ? '&' : '?') + 'cityId=' + encodeURIComponent(cityId) : url;
export async function loadCity() {
  const city = await request<CityManifest>('/api/cities/default');
  if (city.apiVersion !== CITY_PACKAGE_API_VERSION) throw new Error('Versión de la ciudad incompatible. Recarga la aplicación.');
  cityId = city.id;
  return city;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(90_000), ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "El servicio no está disponible. Inténtalo de nuevo.");
  return body as T;
}
export const loadNetwork = () => request<Network>(inCity('/api/network'));
export const loadSnapshot = () => request<Snapshot>(inCity('/api/transit'));
export const loadShapes = (keys: string[]) => request<Shape[]>(inCity('/api/geometries'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) });
export const loadLine = (route: Route, direction = 'all') => request<LineDetail>(inCity(`/api/lines/${encodeURIComponent(route.operatorId)}/${encodeURIComponent(route.externalId)}?direction=${encodeURIComponent(direction)}`));
export const loadStop = (stop: Stop) => request<StopDetail>(inCity(`/api/stops/${encodeURIComponent(stop.operatorId)}/${encodeURIComponent(stop.externalId)}`));
export const loadTrip = (vehicle: Vehicle) => request<TripDetail>(inCity(`/api/trips/${encodeURIComponent(vehicle.operatorId)}/${encodeURIComponent(vehicle.externalTripId)}?date=${vehicle.serviceDate}&vehicleId=${encodeURIComponent(vehicle.id)}`));
