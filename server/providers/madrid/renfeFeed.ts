import { freshTimestamp, type RealtimeMessage } from '../../transit/realtime';
import type { RealtimeFeedState } from '../realtimeFeed';

type Feed = { get(now?: number): Promise<RealtimeFeedState> };

/** Madrid's journeys in Renfe's national feeds: trip IDs of nucleus 10 or one of its routes. */
export function coversMadrid(feed: RealtimeMessage, routeIds: ReadonlySet<string>) {
  return (feed.entity ?? []).some((entity) => {
    const trip = entity.tripUpdate?.trip ?? entity.vehicle?.trip;
    return !!trip && (/^(SPECIAL_)?10/.test(trip.tripId ?? '') || routeIds.has(trip.routeId ?? ''));
  });
}

/**
 * Renfe alternates its national VehiclePositions and TripUpdates: about one
 * publication in three leaves out nucleus 10 entirely (16 Oct 2026: 296 entities
 * with 95 Madrid trains, then 202 with none, every ~20 s). Taken at face value,
 * every Cercanías train fell back to its timetable for that publication and
 * then jumped back to its GPS. A publication without a single Madrid journey
 * is not news about Madrid: the previous one stays while it is fresh, with its
 * own source and receipt times.
 */
export class MadridRenfeFeed implements Feed {
  private covered?: RealtimeFeedState;
  constructor(private readonly client: Feed, private readonly covers: (feed: RealtimeMessage) => boolean) {}
  async get(now = Date.now()): Promise<RealtimeFeedState> {
    const state = await this.client.get(now);
    if (state.feed && this.covers(state.feed)) { this.covered = state; return state; }
    if (this.covered?.feed && freshTimestamp(this.covered.feed.header?.timestamp, now) !== null) return this.covered;
    return state;
  }
}
