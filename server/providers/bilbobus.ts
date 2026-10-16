import proj4 from 'proj4';
import { XMLParser } from 'fast-xml-parser';
import type { BizkaibusGtfs, GtfsTrip } from './bizkaibus/gtfs';
import { StaticGtfsProvider } from './staticGtfs';
import { formatServiceDate, getActiveTrips } from '../transit/gtfsCalendar';
import { freshTimestamp } from '../transit/realtime';
import { serviceEpoch, tripPlan } from '../transit/plans';
import { distanceMeters, positionAtProgress, projectOntoShape, type Coordinate, type ShapeMetric } from '../transit/motionEngine';
import { ObservationTracker } from '../transit/observations';
import type { ProviderSnapshot, TransitVehicle } from '../transit/types';
import type { Departure } from '../../shared/transit/network';
import { passengerHeadsign } from '../transit/labels';
import { coveringStops } from '../transit/coveringStops';

export const BILBOBUS_POSITIONS = 'https://api.bilbao.eus/bilbobus/Ultimas_posiciones';
export const BILBOBUS_SIRI = 'https://api.bilbao.eus/sae/SIRI.svc';
const POSITION_POLL_MS = 15_000;
/** A fix arrives every 20 s; the stop panels that bound where a bus is drawn are refreshed every other one. */
const FLEET_REFRESH_MS = 30_000;
const FLEET_CONCURRENCY = 4;
const ED50 = '+proj=utm +zone=30 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs';
export type BilbobusPosition = { Vehiculo: number; LineaCodigoOriginal: number | string; lineIdPerm: number; CoordX: number; CoordY: number; Instante: string; Ruta: number; Viaje: number; Velocidad: number; Posicion?: number | string };
export function ed50ToWgs84(x: number, y: number): [number, number] | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const coordinate = proj4(ED50, 'EPSG:4326', [x, y]) as [number, number];
  return coordinate[0] > -3.2 && coordinate[0] < -2.7 && coordinate[1] > 43.1 && coordinate[1] < 43.5 ? coordinate : null;
}
const wallFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function bilbobusPositionTimestamp(value: string, receivedAt = Date.now()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  // Audited against HTTP Date: Instante is Madrid wall time, despite its misleading Z suffix.
  const approximate = serviceEpoch(`${match[1]}${match[2]}${match[3]}`, Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6]));
  const expected = match.slice(1).join('');
  const candidates = [-3600_000, 0, 3600_000].map((offset) => approximate + offset).filter((at) => {
    const parts = wallFormatter.formatToParts(at);
    return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((type) => parts.find((p) => p.type === type)!.value).join('') === expected;
  });
  // In the repeated autumn hour choose the most recent possible observation before receipt.
  candidates.sort((a, b) => (a > receivedAt ? 1 : 0) - (b > receivedAt ? 1 : 0) || Math.abs(a - receivedAt) - Math.abs(b - receivedAt));
  return candidates[0] ?? null;
}

const MAX_OFFICIAL_PROGRESS_GPS_DISTANCE_METERS = 200;
const MAX_NEAREST_SHAPE_DISTANCE_METERS = 120;
/**
 * Bilbobus publishes both a GPS coordinate and Posicion, its linear reference
 * along the route. The latter disambiguates loops, roundabouts and nearby
 * parallel segments, but is accepted only when the shape puts it near the GPS.
 */
export function bilbobusProgress(metric: ShapeMetric, coordinate: Coordinate, providerProgress: unknown) {
  const nearest = projectOntoShape(metric, coordinate);
  const fallback = nearest ? { ...nearest, source: 'gps' as const } : null;
  const progress = typeof providerProgress === 'number' ? providerProgress : typeof providerProgress === 'string' && providerProgress.trim() ? Number(providerProgress) : NaN;
  if (!Number.isFinite(progress) || progress < 0 || progress > metric.totalMeters) return fallback;
  const official = positionAtProgress(metric, progress);
  if (!official) return fallback;
  const distance = distanceMeters(official.coordinate, coordinate);
  return distance <= MAX_OFFICIAL_PROGRESS_GPS_DISTANCE_METERS
    ? { ...official, distanceMeters: distance, source: 'provider' as const }
    : fallback;
}

/** `distance`: metres the bus has left to the stop when recorded (0 or a few negative once it has arrived), when published. */
export type SiriArrival = { vehicleId: string; journeyId: string; line: string; directionId: number | null; stopCode: string; destination: string; arrival: number; departure: number; recordedAt: number; distance: number | null };
const xmlParser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, processEntities: false });
const string = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function parseSiriArrivals(xml: string, stopCode: string, now = Date.now()): SiriArrival[] {
  const result = xmlParser.parse(xml)?.Envelope?.Body?.GetStopMonitoringResponse?.GetStopMonitoringResult;
  if (!result || string(result.ServiceException?.Notice)) throw new Error(string(result?.ServiceException?.Notice) || 'Respuesta SIRI inválida');
  const visits = result.MonitoredStopVisits?.MonitoredStopVisit ?? [];
  return (Array.isArray(visits) ? visits : [visits]).flatMap((visit) => {
    const journey = visit.MonitoredVehicleJourney, call = journey?.MonitoredCall;
    const recordedAt = Date.parse(string(visit.RecordedAtTime)), arrival = Date.parse(string(call?.ExpectedArrivalTime)), departure = Date.parse(string(call?.ExpectedDepartureTime));
    if (!journey || string(call?.StopPointRef) !== stopCode || freshTimestamp(recordedAt / 1000, now) === null || !Number.isFinite(arrival)) return [];
    return [{ vehicleId: string(journey.VehicleRef).replace(/^VEH_/, ''), journeyId: string(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef), line: string(journey.LineRef).replace(/^L/, ''), directionId: /^Ida$/i.test(string(journey.DirectionRef)) ? 0 : /^Vuelta$/i.test(string(journey.DirectionRef)) ? 1 : null, stopCode, destination: string(journey.DestinationName), arrival, departure: Number.isFinite(departure) ? departure : arrival, recordedAt, distance: string(call.DistanceFromStop).trim() && Number.isFinite(Number(call.DistanceFromStop)) ? Number(call.DistanceFromStop) : null }];
  });
}

/**
 * A bus placed before but without a usable fix now (its line request failed, the
 * reply left it out, or the fix was rejected or fits no trip) stays where it last
 * was while that fix is fresh, instead of vanishing. Stale ones are forgotten.
 */
export function keepRecentlyPlaced(placed: Map<string, TransitVehicle>, seen: ReadonlySet<string>, now: number): TransitVehicle[] {
  const kept: TransitVehicle[] = [];
  for (const [vehicleId, vehicle] of placed) {
    if (seen.has(vehicleId)) continue;
    const at = vehicle.observationTimestamp;
    if (at == null || freshTimestamp(at / 1000, now) === null) { placed.delete(vehicleId); continue; }
    kept.push({ ...vehicle, predictionTimestamp: now, positionQuality: now - at <= 45_000 ? 'live' : 'predicted' });
  }
  return kept;
}

export class BilbobusProvider extends StaticGtfsProvider {
  private rows: BilbobusPosition[] = [];
  private positionsReceivedTimestamp: number | null = null;
  private nextPoll = 0;
  private pending: Promise<void> | null = null;
  private failures = 0;
  private observations = new ObservationTracker();
  private placed = new Map<string, TransitVehicle>();
  private siri = new Map<string, { expires: number; promise: Promise<SiriArrival[]>; rows?: SiriArrival[] }>();
  constructor() { super('bilbobus', 'https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfs_bilbobus.zip', { prepare: (gtfs) => gtfs.routes.forEach((r) => { r.color = 'C33B42'; }) }); }
  private async poll(gtfs: BizkaibusGtfs, now: Date) {
    if (Date.now() < this.nextPoll) return;
    if (this.pending) return this.pending;
    // The city publishes a fix every 20 s, about 25 s old when fetched; polling every 30 s let
    // what the map drew age to over a minute. 15 s keeps it near the source (audit 15 Oct 2026).
    this.nextPoll = Date.now() + POSITION_POLL_MS;
    this.pending = (async () => {
      const day = formatServiceDate(now), active = getActiveTrips(gtfs, day.date, day.weekday);
      const origin = serviceEpoch(day.date, 0), seconds = (now.getTime() - origin) / 1000;
      const routes = new Set(active.filter((t) => { const p = tripPlan(gtfs, t.tripId); return p && seconds >= p.anchors[0].seconds - 300 && seconds <= p.anchors.at(-1)!.seconds + 300; }).map((t) => t.routeId));
      const queue = [...routes].flatMap((id) => ['IDA', 'VLT'].map((direction) => ({ line: gtfs.routes.get(id)!.shortName, direction })));
      const rows: BilbobusPosition[] = []; let failures = 0;
      await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) {
        const item = queue.shift()!;
        try {
          const response = await fetch(`${BILBOBUS_POSITIONS}/${encodeURIComponent(item.line)}/${item.direction}`, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json() as { rows?: BilbobusPosition[] };
          if (!Array.isArray(data.rows)) throw new Error('Respuesta de posiciones inválida');
          rows.push(...data.rows);
        } catch { failures++; }
      } }));
      this.failures = failures;
      if (rows.length) { this.rows = rows; this.positionsReceivedTimestamp = Date.now(); }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  async getArrivals(stopCode: string): Promise<SiriArrival[]> {
    if (!/^\d{1,8}$/.test(stopCode)) return [];
    const cached = this.siri.get(stopCode);
    if (cached && Date.now() < cached.expires) return cached.promise;
    const entry: { expires: number; promise: Promise<SiriArrival[]>; rows?: SiriArrival[] } = { expires: Date.now() + 20_000, promise: Promise.resolve([]) };
    entry.promise = (async () => {
      const body = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetStopMonitoring xmlns="http://tempuri.org/"><request xmlns:a="http://schemas.datacontract.org/2004/07/ISAENEXT.siri"><a:RequestTimestamp>${new Date().toISOString()}</a:RequestTimestamp><a:version>1.0</a:version><a:MonitoringRef>${stopCode}</a:MonitoringRef></request></GetStopMonitoring></s:Body></s:Envelope>`;
      const response = await fetch(BILBOBUS_SIRI, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://tempuri.org/ISIRI/GetStopMonitoring' }, body, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`SIRI HTTP ${response.status}`);
      entry.rows = parseSiriArrivals(await response.text(), stopCode); return entry.rows;
    })();
    this.siri.set(stopCode, entry);
    if (this.siri.size > 200) for (const [key, value] of this.siri) if (Date.now() - value.expires > 600_000) this.siri.delete(key);
    return entry.promise;
  }
  private nextFleetRefresh = 0;
  private fleetPending: Promise<void> | null = null;
  lastFleetRefresh: { at: number; vehicles: number; covered: number; stops: number; failures: number } | null = null;
  /**
   * Every live bus needs its SIRI stop panels: they keep it from being drawn past a stop it has
   * not reached. Before, only the selected bus and those at an open stop had them. Runs only while
   * the snapshot is being requested, at most once per FLEET_REFRESH_MS.
   */
  private refreshFleet(gtfs: BizkaibusGtfs, vehicles: TransitVehicle[]) {
    if (this.fleetPending || Date.now() < this.nextFleetRefresh) return;
    this.nextFleetRefresh = Infinity;
    this.fleetPending = (async () => {
      const live = vehicles.filter((v) => v.vehicleId && v.observationTimestamp !== null).map((v) => ({ vehicleId: v.vehicleId, tripId: v.tripId, routeId: v.routeId, headsign: gtfs.trips.get(v.tripId)?.headsign ?? '', progressMetersAlongShape: v.progressMetersAlongShape }));
      const stops = coveringStops(gtfs, live);
      const queue = stops.stopIds.flatMap((id) => gtfs.stops.get(id)?.stopCode ?? []);
      let failures = 0;
      await Promise.all(Array.from({ length: FLEET_CONCURRENCY }, async () => {
        while (queue.length) await this.getArrivals(queue.shift()!).catch(() => { failures++; });
      }));
      this.lastFleetRefresh = { at: Date.now(), vehicles: live.length, covered: stops.covered, stops: stops.stopIds.length, failures };
    })().catch(() => {}).finally(() => { this.fleetPending = null; this.nextFleetRefresh = Date.now() + FLEET_REFRESH_MS; });
  }
  peekArrival(vehicleId: string | null | undefined, stopCode: string) {
    // A bus can be listed twice at a stop, on this trip and on its next one: this one is the nearest.
    const rows = this.siri.get(stopCode)?.rows?.filter((r) => r.vehicleId === vehicleId && freshTimestamp(r.recordedAt / 1000, Date.now()) !== null) ?? [];
    return rows.reduce<SiriArrival | undefined>((best, row) => !best || (row.distance ?? Infinity) < (best.distance ?? Infinity) ? row : best, undefined);
  }
  async departures(gtfs: BizkaibusGtfs, stopCode: string): Promise<Departure[]> {
    const arrivals = await this.getArrivals(stopCode);
    return arrivals.flatMap((arrival) => {
      const route = [...gtfs.routes.values()].find((r) => r.shortName.replace(/^0+(?=\d)/, '') === arrival.line.replace(/^0+(?=\d)/, ''));
      return route ? [{ routeKey: `bilbobus:${route.routeId}`, tripId: arrival.journeyId, vehicleId: arrival.vehicleId, label: route.shortName, headsign: arrival.destination, operatorId: 'bilbobus', at: arrival.departure, quality: 'predicted' as const, source: 'realtime' as const, updatedAt: arrival.recordedAt, delaySeconds: null, directionId: arrival.directionId }] : [];
    }).filter((d) => d.at >= Date.now() - 30_000);
  }
  async getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    const [base, gtfs] = await Promise.all([super.getSnapshot(now), this.getGtfs()]); void this.poll(gtfs, now).catch(() => { this.failures++; });
    const day = formatServiceDate(now), origin = serviceEpoch(day.date, 0), seconds = (now.getTime() - origin) / 1000;
    const active = getActiveTrips(gtfs, day.date, day.weekday);
    const byRoute = new Map<string, GtfsTrip[]>();
    for (const trip of active) { if (!byRoute.has(trip.routeId)) byRoute.set(trip.routeId, []); byRoute.get(trip.routeId)!.push(trip); }
    const vehicles = new Map(base.vehicles.map((v) => [v.id, v])), seen = new Set<string>();
    for (const row of this.rows) {
      const routeId = String(row.lineIdPerm), observedAt = bilbobusPositionTimestamp(row.Instante), coordinate = ed50ToWgs84(Number(row.CoordX), Number(row.CoordY)), vehicleId = String(row.Vehiculo);
      if (!coordinate || observedAt === null || freshTimestamp(observedAt / 1000, now.getTime()) === null || seen.has(vehicleId)) continue;
      const directionId = row.Ruta === 1 ? 0 : row.Ruta === 2 ? 1 : null;
      const candidates = (byRoute.get(routeId) ?? []).filter((t) => t.directionId === directionId && t.shapeId);
      const projections = new Map<string, ReturnType<typeof bilbobusProgress>>();
      let best: { trip: GtfsTrip; progress: number; score: number; distance: number } | null = null;
      for (const trip of candidates) {
        const plan = tripPlan(gtfs, trip.tripId); if (!plan) continue;
        if (!projections.has(trip.shapeId!)) projections.set(trip.shapeId!, bilbobusProgress(plan.metric, coordinate, row.Posicion));
        const projected = projections.get(trip.shapeId!)!;
        const maximumDistance = projected?.source === 'provider' ? MAX_OFFICIAL_PROGRESS_GPS_DISTANCE_METERS : MAX_NEAREST_SHAPE_DISTANCE_METERS;
        if (!projected || projected.distanceMeters > maximumDistance) continue;
        const next = plan.anchors.findIndex((a) => a.progress >= projected.progressMeters);
        const a = plan.anchors[Math.max(0, next - 1)], b = plan.anchors[next < 0 ? plan.anchors.length - 1 : next];
        const scheduledSeconds = a.seconds + (b.seconds - a.seconds) * ((projected.progressMeters - a.progress) / Math.max(1, b.progress - a.progress));
        const observedSeconds = (observedAt - origin) / 1000;
        const score = projected.distanceMeters + Math.abs(observedSeconds - scheduledSeconds) * .2;
        if (!best || score < best.score) best = { trip, progress: projected.progressMeters, distance: projected.distanceMeters, score };
      }
      if (!best) continue;
      const history = this.observations.accept(`${vehicleId}:${day.date}:${best.trip.shapeId}`, { at: observedAt, progress: best.progress }, 'bus', now.getTime());
      if (!history) continue;
      seen.add(vehicleId);
      const plan = tripPlan(gtfs, best.trip.tripId)!, position = positionAtProgress(plan.metric, best.progress)!;
      // Remove only the timetable stand-in actually associated with this physical bus.
      for (const [id, v] of vehicles) if (v.tripId === best.trip.tripId && !v.vehicleId) vehicles.delete(id);
      const id = `bilbobus:${day.date}:vehicle-${vehicleId}`;
      const vehicle: TransitVehicle = { id, operatorId: 'bilbobus', tripId: best.trip.tripId, vehicleId, routeId, mode: 'bus', directionId, shapeId: best.trip.shapeId!, progressMetersAlongShape: position.progressMeters, observationProgressMeters: position.progressMeters, previousObservation: history.previous, // Velocidad is instantaneous: 0 at a light or 30 km/h between stops. Neither
      // predicts the next minute, so motion uses the pace between real fixes.
      speedMetersPerSecond: history.pace ?? history.speed, longitude: position.coordinate[0], latitude: position.coordinate[1], bearing: position.bearing, observationTimestamp: observedAt, predictionTimestamp: now.getTime(), positionQuality: now.getTime() - observedAt <= 45_000 ? 'live' : 'predicted', delaySeconds: null, tripIdentityQuality: 'estimated', positionSource: 'gps' };
      vehicles.set(id, vehicle); this.placed.set(vehicleId, vehicle);
    }
    for (const vehicle of keepRecentlyPlaced(this.placed, seen, now.getTime())) {
      for (const [id, v] of vehicles) if (v.tripId === vehicle.tripId && !v.vehicleId) vehicles.delete(id);
      vehicles.set(vehicle.id, vehicle);
    }
    const real = [...vehicles.values()].filter((v) => v.vehicleId);
    // Stop panels for the whole fleet refresh in the background; the snapshot never waits for them.
    this.refreshFleet(gtfs, real);
    const observedDirections = new Set(real.map((v) => `${v.routeId}:${v.directionId}`));
    for (const [id, vehicle] of vehicles) if (!vehicle.vehicleId && observedDirections.has(`${vehicle.routeId}:${vehicle.directionId}`)) vehicles.delete(id);
    return { ...base, vehicles: [...vehicles.values()].map((v) => ({ ...v, receivedTimestamp: v.observationTimestamp !== null ? this.positionsReceivedTimestamp : base.receivedTimestamp ?? null })), receivedTimestamp: real.length ? this.positionsReceivedTimestamp : base.receivedTimestamp, sourceTimestamp: real.length ? Math.max(...real.map((v) => v.observationTimestamp!)) : null, status: real.length ? this.failures ? 'degraded' : 'ok' : 'degraded', ...(!real.length ? { error: 'No hay posiciones municipales recientes; se muestra el horario.' } : {}) };
  }
}
export const bilbobusProvider = new BilbobusProvider();
