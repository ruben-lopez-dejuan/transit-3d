import type { BizkaibusGtfs } from '../bizkaibus/gtfs';
import type { AdapterSnapshot, SourceAdapter } from '../../../shared/transit/contracts';
import type { Departure } from '../../../shared/transit/network';
import type { StopArrivalsAdapter } from '../../transit/cityPackage';
import { entityId } from '../../../shared/transit/ids';
import { isFresh } from '../../../shared/transit/freshness';
import { MetroFeedClient } from './metroFeed';
import { MetroEstimates } from './metroEstimates';

export class MetroArrivalProvider implements SourceAdapter {
  private estimates: MetroEstimates;
  readonly arrivals: StopArrivalsAdapter;
  constructor(readonly operatorId: string, private readonly gtfs: () => Promise<BizkaibusGtfs>, private readonly client: MetroFeedClient, lines: ReadonlyMap<string, string>, cityId: string, private readonly fallback?: SourceAdapter) {
    this.estimates = new MetroEstimates(lines);
    this.arrivals = {
      departures: async (gtfs, stopId) => {
        const events = this.estimates.events(gtfs, this.client.get().boards, Date.now());
        return events.filter((e) => e.pattern.stops[e.index].id === stopId).map((e): Departure => ({ routeKey: entityId(cityId, operatorId, 'route', e.pattern.routeId), tripId: entityId(cityId, operatorId, 'trip', e.pattern.tripId), label: gtfs.routes.get(e.pattern.routeId)!.shortName, headsign: e.destination, operatorId, at: e.at, quality: 'predicted', source: 'realtime', updatedAt: e.source, directionId: e.pattern.directionId, delaySeconds: null }));
      },
      warm: async () => {}, // One aggregated feed, no requests for individual stations.
      peek: () => null, // No physical train ID: do not assign a station board to a specific convoy.
    };
  }
  async getSnapshot(now = new Date()): Promise<AdapterSnapshot> {
    const gtfs = await this.gtfs(), state = this.client.get(), at = now.getTime();
    const events = this.estimates.events(gtfs, state.boards, at);
    const estimates = this.estimates.vehicles(gtfs, state.boards, at, this.operatorId).map((v) => ({ ...v, receivedTimestamp: state.receivedTimestamp }));
    const base = this.fallback ? await this.fallback.getSnapshot(now) : null;
    const covered = new Set(events.map((e) => e.pattern.routeId));
    const vehicles = [...(base?.vehicles.filter((v) => !covered.has(v.routeId)) ?? []), ...estimates];
    const fresh = state.boards.filter((b) => isFresh(b.sourceTimestamp, at));
    const missing = [...gtfs.routes.values()].filter((r) => !(gtfs.routeTripIds.get(r.routeId)?.length)).map((r) => r.shortName);
    const error = state.error ?? (missing.length ? `Falta topología utilizable para las líneas ${missing.join(', ')}; continúan las demás.` : !events.length ? fresh.length ? 'No hay teleindicadores vigentes asociados inequívocamente a esta topología.' : this.fallback ? 'No hay teleindicadores recientes; se conserva el horario vigente.' : 'No hay teleindicadores recientes. La topología de Metro no aporta un horario vigente.' : undefined);
    const sourceTimestamp = events.length ? Math.max(...events.map((e) => e.source)) : state.boards.length ? Math.max(...state.boards.map((b) => b.sourceTimestamp)) : null;
    return { operatorId: this.operatorId, fetchedAt: at, sourceTimestamp, receivedTimestamp: state.receivedTimestamp, vehicles, realtimeArrivalCount: events.length, realtimeTripCount: estimates.length, status: events.length && !error ? 'ok' : 'degraded', ...(error ? { error } : {}) };
  }
}
