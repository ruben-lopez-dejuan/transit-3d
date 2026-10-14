import { XMLParser } from 'fast-xml-parser';
import type { BizkaibusGtfs } from './gtfs';
import { getBizkaibusSnapshot, type LiveVehicle } from './service';
import { tripPlan } from '../../transit/plans';
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
/** The official meters are measured about a feed cycle later than our GPS, so the tolerance allows that travel. */
const tolerance = (meters: number) => Math.max(1000, meters * .2);

/** Pair passing times with GPS vehicles by line, destination and distance along the trip to the stop. */
export function matchPassingTimes(gtfs: BizkaibusGtfs, stopId: string, rows: PassingTime[], vehicles: LiveVehicle[], recordedAt: number): MatchedPassingTime[] {
  const candidates = vehicles.flatMap((vehicle) => {
    const stop = tripPlan(gtfs, vehicle.tripId)?.stops.find((s) => s.stopId === stopId && s.progress >= vehicle.progressMetersAlongShape - 30);
    return stop && vehicle.vehicleId ? [{ vehicle, line: gtfs.routes.get(vehicle.routeId)?.shortName ?? '', headsign: normalize(vehicle.headsign), distance: Math.max(0, stop.progress - vehicle.progressMetersAlongShape) }] : [];
  });
  const pairs = rows.flatMap((row, index) => candidates.flatMap((candidate) => {
    const destination = normalize(row.destination);
    if (candidate.line !== row.line || (destination && candidate.headsign && destination !== candidate.headsign)) return [];
    const difference = Math.abs(candidate.distance - row.meters);
    return difference <= tolerance(row.meters) ? [{ index, candidate, difference }] : [];
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
    const entry = this.cache.get(stopId);
    return vehicleId && entry && Date.now() - entry.expires < 60_000 ? entry.rows?.find((row) => row.vehicleId === vehicleId) ?? null : null;
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
