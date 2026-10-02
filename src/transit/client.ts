import type { Network, Snapshot, Shape, LineDetail, StopDetail, TripDetail, Vehicle, Route, Stop } from "./networkTypes";

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(90_000), ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "El servicio no está disponible. Inténtalo de nuevo.");
  return body as T;
}
export const loadNetwork = () => request<Network>("/api/network");
export const loadSnapshot = () => request<Snapshot>("/api/transit");
export const loadShapes = (keys: string[]) => request<Shape[]>("/api/geometries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys }) });
export const loadLine = (route: Route, direction = "all") => request<LineDetail>(`/api/lines/${encodeURIComponent(route.operatorId)}/${encodeURIComponent(route.routeId)}?direction=${encodeURIComponent(direction)}`);
export const loadStop = (stop: Stop) => request<StopDetail>(`/api/stops/${encodeURIComponent(stop.operatorId)}/${encodeURIComponent(stop.stopId)}`);
export const loadTrip = (vehicle: Vehicle) => request<TripDetail>(`/api/trips/${encodeURIComponent(vehicle.operatorId)}/${encodeURIComponent(vehicle.tripId)}?date=${vehicle.serviceDate}`);
