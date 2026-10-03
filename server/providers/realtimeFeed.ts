import fs from 'node:fs';
import path from 'node:path';
import bindings from 'gtfs-realtime-bindings';
import { downloadFile } from '../lib/download';
import { freshTimestamp, type RealtimeMessage } from '../transit/realtime';
import type { ResolvedSource, SourceSupplier } from '../sources/types';

export type RealtimeFeedState = { feed: RealtimeMessage | null; sourceTimestamp: number | null; receivedTimestamp: number | null; error?: string };
type FeedOptions = { cacheDirectory?: string; download?: (url: string, destination: string) => Promise<number> };
export function decodeRealtimeFeed(bytes: Buffer): RealtimeMessage {
  const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(bytes), { longs: Number, enums: String }) as RealtimeMessage;
  if (!feed.header?.gtfsRealtimeVersion || feed.header.incrementality === 'DIFFERENTIAL') throw new Error('Unsupported realtime dataset');
  return feed;
}
/** Keep only decodable full datasets; fetching an old file never renews its timestamp. */
export class RealtimeFeedClient {
  private feed: RealtimeMessage | null = null;
  private receivedTimestamp: number | null = null;
  private expires = 0;
  private error: string | undefined;
  private pending: Promise<RealtimeFeedState> | null = null;
  private cacheLoaded = false;
  private readonly file: string;
  private readonly source: SourceSupplier;
  constructor(readonly name: string, source: string | SourceSupplier, private readonly options: FeedOptions = {}) {
    this.source = typeof source === 'string' ? async (): Promise<ResolvedSource> => ({ url: source, identity: `http:${source}`, temporary: false }) : source;
    this.file = path.join(options.cacheDirectory ?? path.resolve('server/cache/realtime'), `${name}.pb`);
  }
  get(now = Date.now()): Promise<RealtimeFeedState> {
    if (!this.cacheLoaded) {
      this.cacheLoaded = true;
      // A restart must not discard usable realtime while its independent refresh runs.
      // Receipt is unknown after restart; mtime and the current query are not signal time.
      if (!this.feed && fs.existsSync(this.file)) {
        try { this.feed = decodeRealtimeFeed(fs.readFileSync(this.file)); }
        catch { this.error = 'Caché realtime inválida; se intenta recuperar la fuente.'; }
      }
    }
    if (!this.pending && now >= this.expires) {
      this.expires = now + 15_000;
      this.pending = this.refresh().then(() => this.state(Date.now())).finally(() => { this.pending = null; this.expires = Date.now() + 15_000; });
    }
    // Sources refresh independently; an unavailable operator must not block the map.
    return Promise.resolve(this.state(now));
  }

  private state(now: number): RealtimeFeedState {
    const fresh = this.feed && freshTimestamp(this.feed.header?.timestamp, now) !== null;
    const timestamp = this.feed?.header?.timestamp;
    const sourceTimestamp = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : null;
    return { feed: fresh ? this.feed : null, sourceTimestamp, receivedTimestamp: this.receivedTimestamp, ...(this.error ? { error: this.error } : !fresh ? { error: 'Realtime ausente o con más de 180 s de antigüedad; se usa el horario.' } : {}) };
  }
  private async refresh() {
    const file = this.file, candidate = `${file}.${process.pid}.candidate`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const source = await this.source();
      if (this.options.download) await this.options.download(source.url, candidate);
      else await downloadFile(source.headers ? { url: source.url, headers: source.headers } : source.url, candidate);
      const bytes = fs.readFileSync(candidate), feed = decodeRealtimeFeed(bytes);
      this.feed = feed; this.receivedTimestamp = Date.now(); this.error = undefined;
      fs.writeFileSync(file, bytes);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      if (!this.feed && fs.existsSync(file)) { try { this.feed = decodeRealtimeFeed(fs.readFileSync(file)); } catch { /* Invalid disk data is never used. */ } }
    } finally { try { fs.rmSync(candidate, { force: true }); } catch { /* A read-only cache must not reject the background task. */ } }
  }
}
