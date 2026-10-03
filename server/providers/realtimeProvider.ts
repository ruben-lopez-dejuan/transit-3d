import type { BizkaibusGtfs } from './bizkaibus/gtfs';
import { RealtimeFeedClient } from './realtimeFeed';
import { normalizeTripUpdates, type UpdatedTrip } from '../transit/realtime';
import type { TransitProvider, ProviderSnapshot } from '../transit/types';
import { applyRealtime } from '../transit/applyRealtime';
export { applyRealtime } from '../transit/applyRealtime';

export class RealtimeProvider implements TransitProvider {
  readonly operatorId: string;
  updates = new Map<string, UpdatedTrip>();
  constructor(private readonly base: TransitProvider, private readonly getGtfs: () => Promise<BizkaibusGtfs>, private readonly timetable?: RealtimeFeedClient, private readonly gps?: RealtimeFeedClient, private readonly maximumGpsSpeed?: number, private readonly timezone = 'Europe/Madrid') { this.operatorId = base.operatorId; }
  async getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    const [snapshot, gtfs, timetableState, gps] = await Promise.all([this.base.getSnapshot(now), this.getGtfs(), this.timetable?.get(), this.gps?.get()]);
    const timetable = timetableState ?? { feed: null, sourceTimestamp: null, receivedTimestamp: null };
    this.updates = normalizeTripUpdates(gtfs, timetable.feed, now, this.timezone);
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
      ...snapshot, vehicles, receivedTimestamp, sourceTimestamp, realtimeTripCount: this.updates.size,
      status: hasTimetable || hasGps ? 'ok' : 'degraded',
      error: errors.length && !hasTimetable && !hasGps ? errors.join('; ') : undefined,
    };
  }
}
