import fs from 'node:fs';
import { TransitRenderer } from '../src/map/transitRenderer';
import { nextStopAhead, officialStop } from '../src/transit/motion';
import { arrivalLabel, consistentArrival, eta } from '../src/ui';
import type { Departure, Shape, StopDetail, TripDetail, Vehicle } from '../shared/transit/network';

/**
 * Checks that a Bizkaibus card agrees with the official stop panels. The passing times of the
 * Diputación (stop panel) are the truth: they list a bus at every stop it has still to reach.
 *
 * Runs the browser's TransitRenderer on /api/transit (every 15 s, as the app does). Every 20 s
 * it takes the next few buses in turn and finds the next stop and arrival label as the card does. Then it opens the panels of that stop and of the stops
 * before and after it:
 * - the official next stop is the first of them whose panel lists this bus;
 * - "ahead" means the panel of the stop before still lists it (drawn past a stop it has not reached);
 * - "behind" means the panel of the card's next stop no longer lists it but the next one does;
 * - the arrival label of the card is compared with the panel's at the card's next stop.
 *
 * With `follow` it instead keeps a few cards open, as someone watching the bus coming to their stop:
 * each card reloads its trip every 15 s (as the app does) for 2 minutes, and is measured from 30 s on.
 *
 * Usage: node --use-system-ca --import tsx server/monitor-bus-consistency.ts <minutes> [output.jsonl] [api] [follow]
 */
const minutes = Number(process.argv[2] ?? 10), output = process.argv[3] ?? 'bus-consistency.jsonl', api = process.argv[4] ?? 'http://localhost:3001', follow = process.argv[5] === 'follow';
const city = 'es-bilbao', operator = 'bizkaibus', BUSES_PER_ROUND = 5;
const renderer = new TransitRenderer({} as never);
const out = fs.createWriteStream(output);
let vehicles: Vehicle[] = [];
const get = async <T>(path: string) => { const response = await fetch(`${api}${path}${path.includes('?') ? '&' : '?'}cityId=${city}`); if (!response.ok) throw new Error(`${path} ${response.status}`); return response.json() as Promise<T>; };

async function refresh() {
  const body = await get<{ vehicles: Vehicle[]; fetchedAt: number; serverTime: number }>('/api/transit');
  vehicles = body.vehicles.filter((v) => v.operatorId === operator);
  const missing = [...new Set(vehicles.map((v) => v.shapeKey))].filter((key) => !renderer.shapes.has(key));
  for (let i = 0; i < missing.length; i += 100) {
    const shapes = await (await fetch(`${api}/api/geometries?cityId=${city}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: missing.slice(i, i + 100) }) })).json() as Shape[];
    for (const shape of shapes) renderer.shapes.set(shape.key, shape);
  }
  renderer.update(vehicles, body.fetchedAt, body.serverTime);
}

const panels = new Map<string, { at: number; rows: Departure[] }>();
async function panel(stopId: string) {
  const cached = panels.get(stopId);
  if (cached && Date.now() - cached.at < 15_000) return cached.rows;
  const rows = (await get<StopDetail>(`/api/stops/${operator}/${encodeURIComponent(stopId)}`)).departures.filter((d) => d.operatorId === operator && d.source === 'realtime');
  panels.set(stopId, { at: Date.now(), rows });
  return rows;
}

type Sample = { verdict: string; etaDifference: number | null };
const samples: Sample[] = [];
let cursor = 0;
const OPEN_CARDS = 4, opened = new Map<string, number>();
async function check(v: Vehicle, record = true) {
  const bus = v.externalVehicleId;
  const trip = await get<TripDetail>(`/api/trips/${operator}/${encodeURIComponent(v.externalTripId)}?date=${v.serviceDate}&vehicleId=${encodeURIComponent(v.id)}`);
  const now = Date.now() + renderer.clockOffset, drawn = renderer.progressMeters(v.id);
  if (drawn === null || !record) return;
  const stops = trip.stops.filter((stop) => !stop.skipped), next = officialStop(stops, v, now) ?? nextStopAhead(stops, drawn);
  if (!next) return;
  const index = stops.indexOf(next);
  const fichaAt = next.at != null ? consistentArrival(next.at, now, !!next.realtime, next.progress - drawn, renderer.diagnostics(v.id)?.renderedSpeed ?? 0) : null;
  // The last stop only lists departures (see matchPassingTimes): its panel never names an arriving bus.
  const around = [index - 1, index, index + 1].filter((i) => i >= 0 && i < stops.length - 1);
  const listing = new Map<number, Departure | null>();
  for (const i of around) {
    const rows = await panel(stops[i].stopId);
    listing.set(i, rows.find((row) => row.vehicleId === bus) ?? null);
  }
  const unpaired = (await panel(next.stopId)).filter((row) => !row.vehicleId && row.label === v.label).length;
  const officialIndex = around.find((i) => listing.get(i));
  const official = listing.get(index) ?? null;
  const verdict = officialIndex !== undefined && officialIndex < index ? 'ahead' : index === stops.length - 1 ? 'last-stop' : officialIndex === undefined ? 'not-listed' : officialIndex > index ? 'behind' : 'ok';
  const fichaMinutes = fichaAt === null ? null : Math.max(0, Math.ceil((fichaAt - now) / 60_000));
  const officialMinutes = official ? Math.max(0, Math.ceil((official.at - now) / 60_000)) : null;
  const etaDifference = fichaMinutes !== null && officialMinutes !== null ? fichaMinutes - officialMinutes : null;
  const officialAt = officialIndex !== undefined ? listing.get(officialIndex)! : null;
  const row = {
    at: new Date().toISOString(), line: v.label, bus, trip: v.externalTripId, headsign: v.headsign,
    gpsAge: v.observationTimestamp ? Math.round((now - v.observationTimestamp) / 1000) : null, positionSource: v.positionSource, timelineSource: v.timelineSource,
    ficha: { next: next.name, label: fichaAt === null ? 'Sin hora' : arrivalLabel(fichaAt, now), source: next.source, metersToNext: Math.round(next.progress - drawn) },
    official: officialIndex === undefined ? null : { next: stops[officialIndex].name, label: eta(officialAt!.at, now), metersFromDrawn: Math.round(stops[officialIndex].progress - drawn), metersFromGps: v.observationProgressMeters == null ? null : Math.round(stops[officialIndex].progress - v.observationProgressMeters) },
    officialAtFichaNext: official ? eta(official.at, now) : null, unpairedSameLine: unpaired, verdict, etaDifference,
  };
  out.write(JSON.stringify(row) + '\n');
  samples.push({ verdict, etaDifference });
  if (verdict !== 'ok' || (etaDifference !== null && Math.abs(etaDifference) >= 2)) console.log(`${row.line} bus ${bus}: ficha «${row.ficha.next}» ${row.ficha.label} · oficial «${row.official?.next ?? '—'}» ${row.official?.label ?? ''} · en la parada de la ficha: ${row.officialAtFichaNext ?? 'no lo lista'} → ${verdict}${etaDifference ? ` (${etaDifference > 0 ? '+' : ''}${etaDifference} min)` : ''}`);
}

const end = Date.now() + minutes * 60_000;
await refresh();
let nextRefresh = Date.now() + 15_000, nextRound = Date.now() + 20_000;
while (Date.now() < end) {
  if (Date.now() >= nextRefresh) { nextRefresh += 15_000; await refresh().catch(() => {}); }
  if (Date.now() >= nextRound) {
    const live = vehicles.filter((v) => v.externalVehicleId && v.observationTimestamp !== null);
    if (follow) {
      nextRound += 15_000;
      for (const [id, since] of opened) if (Date.now() - since > 120_000 || !live.some((v) => v.id === id)) opened.delete(id);
      while (opened.size < OPEN_CARDS && live.length) opened.set(live[cursor++ % live.length].id, Date.now());
      for (const [id, since] of opened) await check(live.find((v) => v.id === id)!, Date.now() - since >= 30_000).catch((error) => console.warn(String(error)));
    } else {
      nextRound += 20_000;
      for (let n = 0; n < Math.min(BUSES_PER_ROUND, live.length); n++) await check(live[cursor++ % live.length]).catch((error) => console.warn(String(error)));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const count = (verdict: string) => samples.filter((s) => s.verdict === verdict).length;
const differences = samples.flatMap((s) => s.etaDifference === null ? [] : [s.etaDifference]);
console.log(JSON.stringify({
  samples: samples.length, ok: count('ok'), ahead: count('ahead'), behind: count('behind'), notListed: count('not-listed'),
  eta: { compared: differences.length, same: differences.filter((d) => d === 0).length, offByOne: differences.filter((d) => Math.abs(d) === 1).length, offByTwoOrMore: differences.filter((d) => Math.abs(d) >= 2).length },
}));
out.end();
process.exit(0);
