import proj4 from 'proj4';
import { XMLParser } from 'fast-xml-parser';
import type { BizkaibusGtfs, GtfsTrip } from './bizkaibus/gtfs';
import { StaticGtfsProvider } from './staticGtfs';
import { formatServiceDate, getActiveTrips } from '../transit/gtfsCalendar';
import { freshTimestamp } from '../transit/realtime';
import { serviceEpoch, tripPlan } from '../transit/plans';
import { positionAtProgress, projectOntoShape } from '../transit/motionEngine';
import { ObservationTracker } from '../transit/observations';
import type { ProviderSnapshot, TransitVehicle } from '../transit/types';
import type { Departure } from '../../shared/transit/network';
import { passengerHeadsign } from '../transit/labels';

export const BILBOBUS_POSITIONS = 'https://api.bilbao.eus/bilbobus/Ultimas_posiciones';
export const BILBOBUS_SIRI = 'https://api.bilbao.eus/sae/SIRI.svc';
const ED50 = '+proj=utm +zone=30 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs';
export type BilbobusPosition = { Vehiculo: number; LineaCodigoOriginal: number | string; lineIdPerm: number; CoordX: number; CoordY: number; Instante: string; Ruta: number; Viaje: number; Velocidad: number };
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

export type SiriArrival = { vehicleId: string; journeyId: string; line: string; directionId: number | null; stopCode: string; destination: string; arrival: number; departure: number; recordedAt: number };
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
    return [{ vehicleId: string(journey.VehicleRef).replace(/^VEH_/, ''), journeyId: string(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef), line: string(journey.LineRef).replace(/^L/, ''), directionId: /^Ida$/i.test(string(journey.DirectionRef)) ? 0 : /^Vuelta$/i.test(string(journey.DirectionRef)) ? 1 : null, stopCode, destination: string(journey.DestinationName), arrival, departure: Number.isFinite(departure) ? departure : arrival, recordedAt }];
  });
}

export class BilbobusProvider extends StaticGtfsProvider {
  private rows: BilbobusPosition[] = [];
  private positionsReceivedTimestamp: number | null = null;
  private nextPoll = 0;
  private pending: Promise<void> | null = null;
  private failures = 0;
  private observations = new ObservationTracker();
  private siri = new Map<string, { expires: number; promise: Promise<SiriArrival[]>; rows?: SiriArrival[] }>();
  constructor() { super('bilbobus', 'https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfs_bilbobus.zip', { prepare: (gtfs) => gtfs.routes.forEach((r) => { r.color = 'C33B42'; }) }); }
  private async poll(gtfs: BizkaibusGtfs, now: Date) {
    if (Date.now() < this.nextPoll) return;
    if (this.pending) return this.pending;
    this.nextPoll = Date.now() + 30_000;
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
  peekArrival(vehicleId: string | null | undefined, stopCode: string) {
    return this.siri.get(stopCode)?.rows?.find((r) => r.vehicleId === vehicleId && freshTimestamp(r.recordedAt / 1000, Date.now()) !== null);
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
      const projections = new Map<string, ReturnType<typeof projectOntoShape>>();
      let best: { trip: GtfsTrip; progress: number; score: number; distance: number } | null = null;
      for (const trip of candidates) {
        const plan = tripPlan(gtfs, trip.tripId); if (!plan) continue;
        if (!projections.has(trip.shapeId!)) projections.set(trip.shapeId!, projectOntoShape(plan.metric, coordinate));
        const projected = projections.get(trip.shapeId!)!;
        if (!projected || projected.distanceMeters > 120) continue;
        const next = plan.anchors.findIndex((a) => a.progress >= projected.progressMeters);
        const a = plan.anchors[Math.max(0, next - 1)], b = plan.anchors[next < 0 ? plan.anchors.length - 1 : next];
        const scheduledSeconds = a.seconds + (b.seconds - a.seconds) * ((projected.progressMeters - a.progress) / Math.max(1, b.progress - a.progress));
        const score = projected.distanceMeters + Math.abs(seconds - scheduledSeconds) * .2;
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
      vehicles.set(id, { id, operatorId: 'bilbobus', tripId: best.trip.tripId, vehicleId, routeId, mode: 'bus', directionId, shapeId: best.trip.shapeId!, progressMetersAlongShape: position.progressMeters, observationProgressMeters: position.progressMeters, previousObservation: history.previous, speedMetersPerSecond: Number.isFinite(row.Velocidad) ? row.Velocidad / 3.6 : history.speed, longitude: position.coordinate[0], latitude: position.coordinate[1], bearing: position.bearing, observationTimestamp: observedAt, predictionTimestamp: now.getTime(), positionQuality: now.getTime() - observedAt <= 45_000 ? 'live' : 'predicted', delaySeconds: null, tripIdentityQuality: 'estimated', positionSource: 'gps' });
    }
    const real = [...vehicles.values()].filter((v) => v.vehicleId);
    const observedDirections = new Set(real.map((v) => `${v.routeId}:${v.directionId}`));
    for (const [id, vehicle] of vehicles) if (!vehicle.vehicleId && observedDirections.has(`${vehicle.routeId}:${vehicle.directionId}`)) vehicles.delete(id);
    return { ...base, vehicles: [...vehicles.values()].map((v) => ({ ...v, receivedTimestamp: v.observationTimestamp !== null ? this.positionsReceivedTimestamp : base.receivedTimestamp ?? null })), receivedTimestamp: real.length ? this.positionsReceivedTimestamp : base.receivedTimestamp, sourceTimestamp: real.length ? Math.max(...real.map((v) => v.observationTimestamp!)) : null, status: real.length ? this.failures ? 'degraded' : 'ok' : 'degraded', ...(!real.length ? { error: 'No hay posiciones municipales recientes; se muestra el horario.' } : {}) };
  }
}
export const bilbobusProvider = new BilbobusProvider();
