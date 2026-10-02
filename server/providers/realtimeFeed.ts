import fs from 'node:fs';
import path from 'node:path';
import bindings from 'gtfs-realtime-bindings';
import { downloadFile } from '../lib/download';
import { freshTimestamp, type RealtimeMessage } from '../transit/realtime';

export type RealtimeFeedState = { feed: RealtimeMessage | null; error?: string };
/** Keep only decodable full datasets; fetching an old file never renews its timestamp. */
export class RealtimeFeedClient {
  private feed: RealtimeMessage | null = null;
  private expires = 0;
  private error: string | undefined;
  private pending: Promise<RealtimeFeedState> | null = null;
  constructor(readonly name: string, readonly url: string) {}
  get(now = Date.now()): Promise<RealtimeFeedState> {
    if (this.pending) return this.pending;
    if (now < this.expires) return Promise.resolve(this.state(now));
    this.expires = now + 15_000;
    this.pending = this.refresh().then(() => this.state(Date.now())).finally(() => { this.pending = null; });
    return this.pending;
  }
  private state(now: number): RealtimeFeedState {
    const fresh = this.feed && freshTimestamp(this.feed.header?.timestamp, now) !== null;
    return { feed: fresh ? this.feed : null, ...(this.error ? { error: this.error } : !fresh ? { error: 'Realtime ausente o con más de 180 s de antigüedad; se usa el horario.' } : {}) };
  }
  private async refresh() {
    const directory = path.resolve('server/cache/realtime');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${this.name}.pb`), candidate = `${file}.candidate`;
    const decode = (bytes: Buffer) => {
      const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(bytes), { longs: Number, enums: String }) as RealtimeMessage;
      if (!feed.header?.gtfsRealtimeVersion || feed.header.incrementality === 'DIFFERENTIAL') throw new Error('Unsupported realtime dataset');
      return feed;
    };
    try {
      await downloadFile(this.url, candidate);
      const bytes = fs.readFileSync(candidate), feed = decode(bytes);
      this.feed = feed; this.error = undefined;
      fs.writeFileSync(file, bytes);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      if (!this.feed && fs.existsSync(file)) { try { this.feed = decode(fs.readFileSync(file)); } catch { /* Invalid disk data is never used. */ } }
    } finally { fs.rmSync(candidate, { force: true }); }
  }
}
