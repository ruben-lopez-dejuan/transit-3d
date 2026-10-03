import type { AdapterVehicle, NormalizedVehicle, NormalizedRoute, NormalizedStop, NormalizedTrip, ProviderDefinition } from '../../shared/transit/contracts';
import { entityId } from '../../shared/transit/ids';
import { isFresh, GPS_LIVE_MAX_AGE_MS } from '../../shared/transit/freshness';
import { formatServiceDate } from './gtfsCalendar';
import { modeFor } from './plans';
import type { GtfsRoute, GtfsStop, GtfsTrip } from '../providers/bizkaibus/gtfs';
type Scope = { cityId: string; providerId: string };
const key = (scope: Scope, kind: Parameters<typeof entityId>[2], id: string) => entityId(scope.cityId, scope.providerId, kind, id);
export function normalizeVehicle(vehicle: AdapterVehicle, scope: Scope & { timezone: string }, receivedTimestamp: number | null, now: number): NormalizedVehicle | null {
  if (vehicle.operatorId !== scope.providerId || !vehicle.id || !vehicle.tripId || !vehicle.routeId || !vehicle.shapeId || !Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude) || Math.abs(vehicle.latitude) > 90 || Math.abs(vehicle.longitude) > 180 || !Number.isFinite(vehicle.progressMetersAlongShape) || vehicle.progressMetersAlongShape < 0) return null;
  if (vehicle.motionTimeline && (vehicle.motionTimeline.length < 2 || vehicle.motionTimeline.length > 500 || vehicle.motionTimeline.some((a, i, anchors) => !Number.isFinite(a.at) || a.at <= 0 || !Number.isFinite(a.progress) || a.progress < 0 || i > 0 && (a.at < anchors[i - 1].at || a.progress < anchors[i - 1].progress)))) return null;
  if (vehicle.arrivalPredictions && (vehicle.arrivalPredictions.length > 200 || vehicle.arrivalPredictions.some((a) => !Number.isFinite(a.at) || a.at <= 0 || !Number.isFinite(a.progress) || a.progress < 0 || !Number.isFinite(a.sourceTimestamp) || a.sourceTimestamp <= 0))) return null;
  const sourceTimestamp = vehicle.observationTimestamp ?? (vehicle.positionQuality === 'scheduled' ? null : vehicle.timetableTimestamp ?? null);
  // Malformed dates must not become apparently fresh GPS or break date formatting.
  if (sourceTimestamp !== null && (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0)) return null;
  const receipt = vehicle.receivedTimestamp === undefined ? receivedTimestamp : vehicle.receivedTimestamp;
  if (receipt !== null && (!Number.isFinite(receipt) || receipt <= 0)) return null;
  const stale = sourceTimestamp !== null && !isFresh(sourceTimestamp, now);
  // Only this adapter boundary understands legacy IDs. Normalized IDs do not encode date positions.
  const legacyDate = /^\d{8}$/.test(vehicle.id.split(':')[1] ?? '') ? vehicle.id.split(':')[1] : undefined;
  const serviceDate = vehicle.serviceDate ?? legacyDate ?? formatServiceDate(new Date(sourceTimestamp ?? now), scope.timezone).date;
  const speed = Number.isFinite(vehicle.speedMetersPerSecond) && vehicle.speedMetersPerSecond! >= 0 ? vehicle.speedMetersPerSecond : null;
  const bearing = Number.isFinite(vehicle.bearing) ? ((vehicle.bearing % 360) + 360) % 360 : 0;
  return {
    ...vehicle, cityId: scope.cityId, providerId: scope.providerId, id: key(scope, 'vehicle', vehicle.id),
    routeId: key(scope, 'route', vehicle.routeId), tripId: key(scope, 'trip', vehicle.tripId), shapeId: key(scope, 'shape', vehicle.shapeId),
    externalRouteId: vehicle.routeId, externalTripId: vehicle.tripId, externalShapeId: vehicle.shapeId,
    vehicleId: vehicle.vehicleId ? key(scope, 'vehicle', vehicle.vehicleId) : null, externalVehicleId: vehicle.vehicleId ?? null,
    serviceDate, routeShortName: '', destination: vehicle.destination ?? '', nextStopId: vehicle.nextStopId ? key(scope, 'stop', vehicle.nextStopId) : undefined, lat: vehicle.latitude, lon: vehicle.longitude, bearing,
    speed, speedMetersPerSecond: speed, sourceTimestamp, receivedTimestamp: receipt,
    positionQuality: vehicle.positionQuality === 'live' && !isFresh(vehicle.observationTimestamp, now, GPS_LIVE_MAX_AGE_MS) ? 'predicted' : vehicle.positionQuality,
    positionSource: stale ? 'STALE' : vehicle.observationTimestamp !== null ? 'GPS' : vehicle.positionQuality === 'scheduled' ? 'SCHEDULE_SIMULATION' : 'PROVIDER_ESTIMATED',
    status: stale ? 'STALE' : vehicle.stoppedAtStop ? 'STOPPED' : 'IN_SERVICE',
  };
}
export function normalizeRoute(route: GtfsRoute, scope: Scope, definition: ProviderDefinition, directions: NormalizedRoute['directions']): NormalizedRoute {
  return { ...scope, id: key(scope, 'route', route.routeId), externalId: route.routeId, shortName: route.shortName, longName: route.longName, mode: modeFor(route.routeType), color: /^#?[a-f\d]{6}$/i.test(route.color) ? '#' + route.color.replace('#', '') : definition.color, textColor: '#' + route.textColor.replace('#', ''), directions };
}
export function normalizeStop(stop: GtfsStop, scope: Scope, modes: NormalizedStop['modes']): NormalizedStop {
  return { ...scope, id: key(scope, 'stop', stop.stopId), externalId: stop.stopId, name: stop.name, longitude: stop.longitude, latitude: stop.latitude, modes };
}
export function normalizeTrip(trip: GtfsTrip, scope: Scope): NormalizedTrip {
  return { ...scope, id: key(scope, 'trip', trip.tripId), externalId: trip.tripId, routeId: key(scope, 'route', trip.routeId), shapeId: trip.shapeId ? key(scope, 'shape', trip.shapeId) : null, serviceId: key(scope, 'service', trip.serviceId), destination: trip.headsign, directionId: trip.directionId };
}
