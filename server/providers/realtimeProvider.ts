import type { BizkaibusGtfs } from './bizkaibus/gtfs';
import type { RealtimeFeedClient } from './realtimeFeed';
/** A realtime source as the provider reads it: the downloading client or a filter over one. */
type FeedSource = Pick<RealtimeFeedClient, 'get'>;
import { normalizeTripUpdates, renumberTrips, type NormalizationStats, type Renumbering, type UpdatedTrip } from '../transit/realtime';
import type { TransitProvider, ProviderSnapshot } from '../transit/types';
import { applyRealtime } from '../transit/applyRealtime';
import type { RealtimeMessage } from '../transit/realtime';
export { applyRealtime } from '../transit/applyRealtime';
export type RealtimePreparation = (gtfs: BizkaibusGtfs, timetable: RealtimeMessage | null, gps: RealtimeMessage | null, now: Date) => RealtimeMessage | null;

const renumberingNote = ({ offset, renamed, unknown }: Renumbering) => `Los TripUpdates numeran cada viaje con su trip_id del GTFS publicado ${offset < 0 ? '+' : '−'}${Math.abs(offset)}; ${renamed} de ${unknown} se han reconocido por su horario.`;
/** Names the lines where the operator publishes only its timetable, so the admin can tell a feed gap from a fault here. */
function echoNote(gtfs: BizkaibusGtfs, echoTripIds: string[], updates: Map<string, UpdatedTrip>) {
  const lineOf = (tripId: string) => { const routeId = gtfs.trips.get(tripId)?.routeId; return routeId ? gtfs.routes.get(routeId)?.shortName || routeId : null; };
  const predicted = new Set([...updates.values()].map((update) => lineOf(update.tripId)));
  const silent = [...new Set(echoTripIds.map(lineOf))].filter((line): line is string => !!line && !predicted.has(line)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const count = echoTripIds.length, plural = count === 1 ? '' : 'n';
  return `${count} viaje${count === 1 ? '' : 's'} del feed solo repite${plural} el horario, sin retraso ni incertidumbre, y no cuenta${plural} como tiempo real${silent.length ? `. Sin ninguna previsión: ${silent.join(', ')}` : ''}.`;
}

export class RealtimeProvider implements TransitProvider {
  readonly operatorId: string;
  updates = new Map<string, UpdatedTrip>();
  /** Renumbering is worked out once per downloaded feed, not on every snapshot. */
  private renumbered = new WeakMap<RealtimeMessage, ReturnType<typeof renumberTrips>>();
  constructor(private readonly base: TransitProvider, private readonly getGtfs: () => Promise<BizkaibusGtfs>, private readonly timetable?: FeedSource, private readonly gps?: FeedSource, private readonly maximumGpsSpeed?: number, private readonly timezone = 'Europe/Madrid', private readonly prepare?: RealtimePreparation) { this.operatorId = base.operatorId; }
  async getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    const [gtfs, timetableState, gps] = await Promise.all([this.getGtfs(), this.timetable?.get(), this.gps?.get()]);
    const timetable = timetableState ?? { feed: null, sourceTimestamp: null, receivedTimestamp: null };
    const prepared = this.prepare ? this.prepare(gtfs, timetable.feed, gps?.feed ?? null, now) : timetable.feed;
    let renumbered = prepared ? this.renumbered.get(prepared) : undefined;
    if (prepared && !renumbered) { renumbered = renumberTrips(gtfs, prepared, now, this.timezone); this.renumbered.set(prepared, renumbered); }
    const feed = renumbered?.feed ?? prepared, renumbering = renumbered?.renumbering;
    const snapshot = await this.base.getSnapshot(now);
    const stats: NormalizationStats = { echoTripIds: [] };
    this.updates = normalizeTripUpdates(gtfs, feed, now, this.timezone, stats);
    const realtimeNotes = [...(renumbering ? [renumberingNote(renumbering)] : []), ...(stats.echoTripIds.length ? [echoNote(gtfs, stats.echoTripIds, this.updates)] : [])];
    const vehicles = applyRealtime(gtfs, snapshot.vehicles, this.operatorId, this.updates, gps?.feed ?? null, now, this.maximumGpsSpeed, this.timezone).map((vehicle) => {
      // An explicitly unknown receipt stays unknown; HTTP query time is unrelated.
      const baseReceipt = vehicle.receivedTimestamp === undefined ? snapshot.receivedTimestamp ?? null : vehicle.receivedTimestamp;
      const receivedTimestamp = vehicle.observationTimestamp !== null
        ? gps ? gps.receivedTimestamp : baseReceipt
        : vehicle.positionQuality === 'predicted' ? timetable.receivedTimestamp : baseReceipt;
      return { ...vehicle, receivedTimestamp };
    });
    const hasTimetable = this.updates.size > 0;
    const hasGps = vehicles.some((v) => v.observationTimestamp !== null);
    const errors = [timetable.error, gps?.error, snapshot.error].filter(Boolean);
    if (!hasTimetable && !hasGps && !errors.length) {
      const feeds = [timetable.feed, gps?.feed].filter(Boolean);
      errors.push(feeds.some((feed) => (feed!.entity?.length ?? 0) > 0)
        ? 'El feed recibido no contiene observaciones vigentes compatibles con esta red; se usa el horario.'
        : 'El feed recibido está vacío para esta red; se usa el horario.');
    }
    const baseTimestamp = snapshot.sourceTimestamp === null ? null : snapshot.sourceTimestamp < 1e12 ? snapshot.sourceTimestamp * 1000 : snapshot.sourceTimestamp;
    const realtimeStates = [timetableState, gps].filter((state) => state?.sourceTimestamp !== null && state?.sourceTimestamp !== undefined);
    const latestState = realtimeStates.sort((a, b) => b!.sourceTimestamp! - a!.sourceTimestamp!)[0];
    const sourceTimestamp = hasTimetable ? Math.max(...[...this.updates.values()].map((u) => u.updatedAt))
      : gps?.feed?.header?.timestamp ? gps.feed.header.timestamp * 1000
      : hasGps ? baseTimestamp : latestState?.sourceTimestamp ?? baseTimestamp;
    const receivedTimestamp = hasTimetable ? timetable.receivedTimestamp
      : hasGps ? gps?.receivedTimestamp ?? snapshot.receivedTimestamp ?? null
      : latestState?.receivedTimestamp ?? snapshot.receivedTimestamp ?? null;
    return {
      ...snapshot, vehicles, receivedTimestamp, sourceTimestamp, realtimeTripCount: this.updates.size, ...(realtimeNotes.length ? { realtimeNotes } : {}),
      status: hasTimetable || hasGps ? 'ok' : 'degraded',
      error: errors.length && !hasTimetable && !hasGps ? errors.join('; ') : undefined,
    };
  }
}
