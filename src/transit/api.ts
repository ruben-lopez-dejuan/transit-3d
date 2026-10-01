import type {
  ActiveRouteResponse,
  RouteListResponse,
  VehiclesResponse,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body?.error ||
      `${response.status} ${response.statusText}`,
    );
  }

  return body as T;
}

export function getRoutes() {
  return getJson<RouteListResponse>("/api/routes");
}

export function getActiveRoute(routeId: string) {
  return getJson<ActiveRouteResponse>(
    `/api/routes/${encodeURIComponent(routeId)}/active`,
  );
}

export function getVehicles(routeId: string) {
  return getJson<VehiclesResponse>(
    `/api/vehicles?routeId=${encodeURIComponent(routeId)}`,
  );
}
