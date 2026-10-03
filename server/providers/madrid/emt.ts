import type { BizkaibusGtfs } from '../bizkaibus/gtfs';
import type { AdapterSnapshot, SourceAdapter } from '../../../shared/transit/contracts';
import type { StopArrivalsAdapter } from '../../transit/cityPackage';
import type { Departure } from '../../../shared/transit/network';
import { entityId } from '../../../shared/transit/ids';
import { isFresh } from '../../../shared/transit/freshness';
import { serviceEpoch } from '../../transit/plans';

const ROOT = 'https://openapi.emtmadrid.es/v2';
type Credentials = { clientId: string; passKey: string };
type ApiResponse = { code?: string; datetime?: string; data?: unknown[] };
export type EmtArrival = { line: string; stop: string; bus: string; destination: string; at: number; sourceTimestamp: number };
const wall = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** EMT's verified server datetime is Madrid civil time, without a UTC offset. */
export function emtTimestamp(value: string, receivedAt: number): number | null {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) { const at = Date.parse(value); return Number.isFinite(at) && at > 0 ? at : null; }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (!m) return null;
  const approximate = serviceEpoch(m[1] + m[2] + m[3], Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]));
  const expected = m.slice(1, 7).join('');
  const candidates = [-3600_000, 0, 3600_000].map((offset) => approximate + offset).filter((at) => {
    const parts = wall.formatToParts(at);
    return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((type) => parts.find((p) => p.type === type)!.value).join('') === expected;
  }).sort((a, b) => Number(a > receivedAt) - Number(b > receivedAt) || Math.abs(a - receivedAt) - Math.abs(b - receivedAt));
  return candidates[0] === undefined ? null : candidates[0] + Number((m[7] ?? '').padEnd(3, '0').slice(0, 3));
}
export function parseEmtArrivals(response: ApiResponse, stop: string, receivedAt: number): EmtArrival[] {
  if (response.code !== '00') throw new Error('EMT rechazó la consulta de llegadas');
  const source = emtTimestamp(response.datetime ?? '', receivedAt);
  if (source === null || !isFresh(source, receivedAt)) return [];
  const data = response.data?.[0] as { Arrive?: unknown[] } | undefined;
  if (!Array.isArray(data?.Arrive)) throw new Error('Respuesta de llegadas EMT inválida');
  return data.Arrive.flatMap((item) => {
    const row = item as { line?: string; stop?: string; bus?: string; destination?: string; estimateArrive?: number };
    const seconds = Number(row.estimateArrive);
    if (String(row.stop ?? '') !== stop || !row.line || !row.bus || row.estimateArrive == null || String(row.estimateArrive).trim() === '' || typeof row.estimateArrive === 'boolean' || !Number.isFinite(seconds) || seconds < 0 || seconds > 2700) return [];
    return [{ line: String(row.line), stop, bus: String(row.bus), destination: String(row.destination ?? ''), at: source + seconds * 1000, sourceTimestamp: source }];
  });
}

/** On-demand stop arrivals only: no fleet-wide station scan or secrets in packages. */
export class EmtClient {
  private token?: { value: string; expires: number };
  private login?: Promise<string>;
  private cache = new Map<string, { expires: number; rows: EmtArrival[]; promise?: Promise<EmtArrival[]> }>();
  private requests: number[] = [];
  private inFlight = 0;
  receivedTimestamp: number | null = null;
  error?: string;
  constructor(private readonly credentials?: Credentials, private readonly request: typeof fetch = fetch, private readonly clock = Date.now) {}
  get configured() { return !!this.credentials?.clientId && !!this.credentials.passKey; }
  private async json(url: string, init: RequestInit): Promise<ApiResponse> {
    const response = await this.request(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!response.ok) { if (response.status === 401 || response.status === 403) this.token = undefined; throw new Error('EMT no pudo atender la consulta'); }
    const text = await response.text(); if (text.length > 2_000_000) throw new Error('Respuesta EMT demasiado grande');
    return JSON.parse(text) as ApiResponse;
  }
  private accessToken(): Promise<string> {
    if (this.token && this.clock() < this.token.expires) return Promise.resolve(this.token.value);
    if (this.login) return this.login;
    this.login = (async () => {
      if (!this.configured) throw new Error('EMT requiere credenciales');
      const result = await this.json(ROOT + '/mobilitylabs/user/login/', { headers: { 'X-ClientId': this.credentials!.clientId, passKey: this.credentials!.passKey } });
      const data = result.data?.[0] as { accessToken?: string; tokenSecExpiration?: number } | undefined;
      if (result.code !== '00' || !data?.accessToken || !Number.isFinite(Number(data.tokenSecExpiration)) || Number(data.tokenSecExpiration) <= 0) throw new Error('EMT no autorizó el acceso');
      this.token = { value: data.accessToken, expires: this.clock() + Math.max(1000, Number(data.tokenSecExpiration) * 1000 - 60_000) };
      return this.token.value;
    })().finally(() => { this.login = undefined; });
    return this.login;
  }
  peek(stop: string): EmtArrival[] { return (this.cache.get(stop)?.rows ?? []).filter((r) => isFresh(r.sourceTimestamp, this.clock()) && r.at >= this.clock() - 30_000); }
  get(stop: string): Promise<EmtArrival[]> {
    if (!this.configured || !/^\d{1,8}$/.test(stop)) return Promise.resolve([]);
    const now = this.clock(), previous = this.cache.get(stop);
    if (previous?.promise) return previous.promise;
    if (previous && previous.expires > now) return Promise.resolve(this.peek(stop));
    this.requests = this.requests.filter((at) => at > now - 60_000);
    if (this.requests.length >= 10 || this.inFlight >= 2) return Promise.resolve(this.peek(stop));
    for (const [key, entry] of this.cache) if (!entry.promise && entry.expires < now - 180_000) this.cache.delete(key);
    if (this.cache.size >= 100 && !previous) return Promise.resolve([]);
    this.requests.push(now); this.inFlight++;
    const entry = { expires: now + 30_000, rows: previous?.rows ?? [] } as { expires: number; rows: EmtArrival[]; promise?: Promise<EmtArrival[]> };
    entry.promise = (async () => {
      try {
        const accessToken = await this.accessToken();
        const data = await this.json(ROOT + `/transport/busemtmad/stops/${stop}/arrives/`, { method: 'POST', headers: { accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ cultureInfo: 'ES', Text_StopRequired_YN: 'Y', Text_EstimationsRequired_YN: 'Y', Text_IncidencesRequired_YN: 'N' }) });
        if (['80', '81', '82'].includes(data.code ?? '')) this.token = undefined;
        const receivedAt = this.clock(), rows = parseEmtArrivals(data, stop, receivedAt);
        entry.rows = rows; this.receivedTimestamp = receivedAt; this.error = undefined;
        return rows;
      } catch { this.error = 'No se pudieron actualizar las llegadas EMT. Se conserva el horario GTFS.'; return this.peek(stop); }
      finally { this.inFlight--; entry.promise = undefined; }
    })();
    this.cache.set(stop, entry);
    return entry.promise;
  }
  latestSource() { return Math.max(0, ...[...this.cache.keys()].flatMap((stop) => this.peek(stop).map((r) => r.sourceTimestamp))) || null; }
}

export class EmtArrivalProvider implements SourceAdapter {
  readonly arrivals: StopArrivalsAdapter;
  constructor(readonly operatorId: string, private readonly base: SourceAdapter, private readonly client: EmtClient, cityId: string) {
    const stopCode = (gtfs: BizkaibusGtfs, id: string) => gtfs.stops.get(id)?.stopCode || id;
    this.arrivals = {
      departures: async (gtfs, stopId) => (await client.get(stopCode(gtfs, stopId))).flatMap((row): Departure[] => {
        const matches = [...gtfs.routes.values()].filter((r) => r.shortName.replace(/^0+(?=\d)/, '') === row.line.replace(/^0+(?=\d)/, ''));
        if (matches.length !== 1) return [];
        return [{ routeKey: entityId(cityId, operatorId, 'route', matches[0].routeId), tripId: entityId(cityId, operatorId, 'trip', `arrival:${row.bus}:${row.stop}`), vehicleId: entityId(cityId, operatorId, 'vehicle', row.bus), label: matches[0].shortName, headsign: row.destination, operatorId, at: row.at, quality: 'predicted', source: 'realtime', updatedAt: row.sourceTimestamp, delaySeconds: null }];
      }),
      warm: async (gtfs, stops) => { for (const id of stops.slice(0, 4)) await client.get(stopCode(gtfs, id)); },
      // Scheduled stand-ins have no verified bus identity: never attach arbitrary ETAs.
      peek: (gtfs, id, vehicleId) => { const row = vehicleId ? client.peek(stopCode(gtfs, id)).find((r) => r.bus === vehicleId) : undefined; return row ? { arrival: row.at, sourceTimestamp: row.sourceTimestamp } : null; },
    };
  }
  async getSnapshot(now?: Date): Promise<AdapterSnapshot> {
    const base = await this.base.getSnapshot(now);
    return { ...base, sourceTimestamp: this.client.latestSource(), receivedTimestamp: this.client.receivedTimestamp ?? base.receivedTimestamp, ...(this.client.error ? { status: 'degraded', error: this.client.error } : {}), realtimeArrivalCount: this.client.latestSource() === null ? 0 : 1 };
  }
}
