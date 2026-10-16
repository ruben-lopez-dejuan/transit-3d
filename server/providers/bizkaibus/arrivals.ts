import { XMLParser } from 'fast-xml-parser';
import type { BizkaibusGtfs } from './gtfs';
import { getBizkaibusSnapshot, type LiveVehicle } from './service';
import { tripPlan } from '../../transit/plans';
import { coveringStops } from '../../transit/coveringStops';
export { coveringStops };
import { passengerHeadsign } from '../../transit/labels';
import type { Departure } from '../../../shared/transit/network';

/**
 * Stop passing times of the official Bizkaibus app (Diputación de Bizkaia,
 * Lantik TQWS). Per stop and line it publishes the next two buses as whole
 * minutes and meters along the route, without vehicle or trip identity.
 */
export const BIZKAIBUS_PASSING_TIMES = 'https://apli.bizkaia.net/apps/danok/tqws/tq.asmx/GetPasoParadaMobile';
const CACHE_MS = 20_000;

export type PassingTime = { line: string; destination: string; minutes: number; meters: number };
/** A passing time with the GPS vehicle whose distance to the stop it matches, when one does. */
export type MatchedPassingTime = PassingTime & { arrival: number; recordedAt: number; vehicleId: string | null; tripId: string | null; routeId: string | null; directionId: number | null };

const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const decode = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The web method returns `<string>code®payload</string>`; 1 is success, 0 and 90 mean the service is unavailable. */
export function parsePassingTimes(xml: string): PassingTime[] {
  const body = /<string[^>]*>([\s\S]*)<\/string>/.exec(xml)?.[1];
  if (body === undefined) throw new Error('Respuesta de tiempos de paso inválida');
  const [code, ...rest] = decode(body).split('®');
  if (code.trim() !== '1') throw new Error(`Tiempos de paso no disponibles (${code.trim()})`);
  const passages = xmlParser.parse(rest.join('®'))?.GetPasoParadaResult?.PasoParada ?? [];
  return (Array.isArray(passages) ? passages : [passages]).flatMap((passage) => ['e1', 'e2'].flatMap((slot) => {
    const minutes = Number(text(passage?.[slot]?.minutos)), meters = Number(text(passage?.[slot]?.metros));
    // An empty slot is published as no minutes and 0 meters.
    if (!text(passage?.[slot]?.minutos) || !Number.isFinite(minutes) || minutes < 0 || !Number.isFinite(meters) || meters < 0) return [];
    return [{ line: text(passage.linea), destination: text(passage.ruta), minutes, meters }];
  }));
}

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/**
 * The official meters describe the bus when they are queried; its GPS fix is 60–90 s older.
 * In that time a bus covers anything from nothing to kilometres on a fast road (the Artxanda
 * tunnels, 80–120 km/h), so the expected meters are the GPS distance minus a typical travel,
 * and anything down to a fast travel still pairs.
 */
const tolerance = (meters: number) => Math.max(500, meters * .15);
const TYPICAL_SPEED = 8, FAST_SPEED = 30;
const DESTINATION_MISMATCH_METERS = 500;

/** Pair passing times with GPS vehicles by line, destination and distance along the trip to the stop. */
export function matchPassingTimes(gtfs: BizkaibusGtfs, stopId: string, rows: PassingTime[], vehicles: LiveVehicle[], recordedAt: number): MatchedPassingTime[] {
  const candidates = vehicles.flatMap((vehicle) => {
    const stops = tripPlan(gtfs, vehicle.tripId)?.stops ?? [];
    const stop = stops.find((s) => s.stopId === stopId && s.progress >= vehicle.progressMetersAlongShape - 30);
    // At a terminal the service lists only departures: for a bus finishing its trip there it
    // gives the meters still to go but the minutes until it leaves again, never its arrival.
    const age = vehicle.timestamp ? Math.max(0, recordedAt / 1000 - vehicle.timestamp) : 0;
    return stop && stop !== stops.at(-1) && vehicle.vehicleId ? [{ vehicle, line: gtfs.routes.get(vehicle.routeId)?.shortName ?? '', headsign: normalize(vehicle.headsign), distance: Math.max(0, stop.progress - vehicle.progressMetersAlongShape), age }] : [];
  });
  const pairs = rows.flatMap((row, index) => candidates.flatMap((candidate) => {
    if (candidate.line !== row.line) return [];
    // The official destination often names a route variant (A2326 «EHU/UPV» for a «BARAKALDO» trip):
    // it breaks ties, but the distance decides.
    const destination = normalize(row.destination);
    const expected = Math.max(0, candidate.distance - TYPICAL_SPEED * candidate.age);
    const reachable = row.meters >= candidate.distance - FAST_SPEED * candidate.age - tolerance(row.meters) && row.meters <= candidate.distance + tolerance(row.meters);
    const difference = Math.abs(expected - row.meters);
    const penalty = destination && candidate.headsign && destination !== candidate.headsign ? DESTINATION_MISMATCH_METERS : 0;
    return reachable ? [{ index, candidate, difference: difference + penalty }] : [];
  })).sort((a, b) => a.difference - b.difference);
  const assigned = new Map<number, (typeof candidates)[number]>(), taken = new Set<string>();
  for (const pair of pairs) {
    if (assigned.has(pair.index) || taken.has(pair.candidate.vehicle.vehicleId!)) continue;
    assigned.set(pair.index, pair.candidate); taken.add(pair.candidate.vehicle.vehicleId!);
  }
  const routeByLine = new Map([...gtfs.routes.values()].map((route) => [route.shortName, route.routeId]));
  return rows.map((row, index) => {
    const vehicle = assigned.get(index)?.vehicle;
    return { ...row, arrival: recordedAt + row.minutes * 60_000, recordedAt, vehicleId: vehicle?.vehicleId ?? null, tripId: vehicle?.tripId ?? null, routeId: vehicle?.routeId ?? routeByLine.get(row.line) ?? null, directionId: vehicle?.directionId ?? null };
  });
}

const FLEET_REFRESH_MS = 60_000;
const FLEET_CONCURRENCY = 4;
const FORECAST_MAX_AGE_MS = 180_000;
type Entry = { expires: number; promise: Promise<MatchedPassingTime[]>; rows?: MatchedPassingTime[] };
export class BizkaibusArrivals {
  private cache = new Map<string, Entry>();
  async get(gtfs: BizkaibusGtfs, stopId: string): Promise<MatchedPassingTime[]> {
    const code = gtfs.stops.get(stopId)?.stopCode ?? '';
    if (!/^\d{1,10}$/.test(code)) return [];
    const cached = this.cache.get(stopId);
    if (cached && Date.now() < cached.expires) return cached.promise;
    const entry: Entry = { expires: Date.now() + CACHE_MS, promise: Promise.resolve([]) };
    entry.promise = (async () => {
      const [response, snapshot] = await Promise.all([
        fetch(BIZKAIBUS_PASSING_TIMES, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `strLinea=*&strParada=${code}`, signal: AbortSignal.timeout(8000) }),
        getBizkaibusSnapshot(),
      ]);
      if (!response.ok) throw new Error(`Tiempos de paso HTTP ${response.status}`);
      const recordedAt = Date.now();
      entry.rows = matchPassingTimes(gtfs, stopId, parsePassingTimes(await response.text()), snapshot.vehicles, recordedAt);
      return entry.rows;
    })();
    // A failed request must not be cached for the whole interval.
    entry.promise.catch(() => { if (this.cache.get(stopId) === entry) this.cache.delete(stopId); });
    this.cache.set(stopId, entry);
    if (this.cache.size > 300) for (const [key, value] of this.cache) if (Date.now() - value.expires > 600_000) this.cache.delete(key);
    return entry.promise;
  }
  peek(stopId: string, vehicleId: string | null | undefined) {
    const row = vehicleId ? this.cache.get(stopId)?.rows?.find((r) => r.vehicleId === vehicleId) : undefined;
    // Outlives a fleet refresh cycle, so a bus never drops back to its GPS pace between two refreshes.
    return row && Date.now() - row.recordedAt <= FORECAST_MAX_AGE_MS ? row : null;
  }
  private nextFleetRefresh = 0;
  private fleetPending: Promise<void> | null = null;
  lastFleetRefresh: { at: number; vehicles: number; covered: number; stops: number; failures: number } | null = null;
  /**
   * Every live bus needs official passing times, or opening one makes it jump
   * from its GPS pace to the forecast. Runs only while the snapshot is being
   * requested, at most once per FLEET_REFRESH_MS.
   */
  refreshFleet(gtfs: BizkaibusGtfs): Promise<void> {
    if (this.fleetPending || Date.now() < this.nextFleetRefresh) return this.fleetPending ?? Promise.resolve();
    this.nextFleetRefresh = Date.now() + FLEET_REFRESH_MS;
    this.fleetPending = (async () => {
      const { vehicles } = await getBizkaibusSnapshot();
      const stops = coveringStops(gtfs, vehicles);
      const queue = [...stops.stopIds];
      let failures = 0;
      await Promise.all(Array.from({ length: FLEET_CONCURRENCY }, async () => {
        while (queue.length) { const stopId = queue.shift()!; await this.get(gtfs, stopId).catch(() => { failures++; }); }
      }));
      this.lastFleetRefresh = { at: Date.now(), vehicles: vehicles.length, covered: stops.covered, stops: stops.stopIds.length, failures };
    })().catch(() => {}).finally(() => { this.fleetPending = null; this.nextFleetRefresh = Date.now() + FLEET_REFRESH_MS; });
    return this.fleetPending;
  }
  async departures(gtfs: BizkaibusGtfs, stopId: string): Promise<(Omit<Departure, 'routeKey' | 'tripId'> & { routeId: string; tripId: string })[]> {
    const rows = await this.get(gtfs, stopId);
    return rows.flatMap((row, index) => row.routeId ? [{
      routeId: row.routeId, tripId: row.tripId ?? `paso:${stopId}:${row.line}:${index}`, vehicleId: row.vehicleId ?? undefined,
      label: row.line, headsign: passengerHeadsign(row.destination, gtfs.routes.get(row.routeId)?.longName ?? ''), operatorId: 'bizkaibus',
      at: row.arrival, quality: 'predicted' as const, source: 'realtime' as const, updatedAt: row.recordedAt, delaySeconds: null, directionId: row.directionId,
    }] : []);
  }
}
export const bizkaibusArrivals = new BizkaibusArrivals();
