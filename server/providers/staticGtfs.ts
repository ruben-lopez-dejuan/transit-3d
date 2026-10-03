import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { downloadFile } from "../lib/download";
import { readParsedFeed, writeParsedFeed } from '../lib/gtfsCache';
import type { BizkaibusGtfs, GtfsRoute } from "./bizkaibus/gtfs";
import { parseGtfsDirectoryStreaming } from '../transit/gtfsParser';
import { generateScheduledVehicles } from "../transit/scheduled";
import { formatServiceDate } from '../transit/gtfsCalendar';
import { shiftDate } from '../transit/plans';
import type { TransitProvider, ProviderSnapshot } from "../transit/types";
import type { ResolvedSource, SourceSupplier } from '../sources/types';

export class StaticGtfsProvider implements TransitProvider {
  private data: Promise<BizkaibusGtfs> | null = null;
  private expires = 0;
  private stale = false;
  private receivedTimestamp: number | null = null;
  constructor(readonly operatorId: string, source: string | SourceSupplier, private readonly options: { includeRoute?: (route: GtfsRoute) => boolean; prepare?: (gtfs: BizkaibusGtfs) => void | Promise<void>; timezone?: string; cacheNamespace?: string } = {}) { this.source = typeof source === 'string' ? async (): Promise<ResolvedSource> => ({ url: source, identity: `http:${source}`, temporary: false }) : source; }
  private readonly source: SourceSupplier;
  getGtfs(): Promise<BizkaibusGtfs> {
    if (!this.data || Date.now() >= this.expires) {
      this.expires = Infinity;
      this.data = this.load().then((feed) => { this.expires = Date.now() + 6 * 3600_000; return feed; }).catch((error) => { this.data = null; throw error; });
    }
    return this.data;
  }
  private async load() {
    const directory = this.options.cacheNamespace ? path.resolve('server/cache', encodeURIComponent(this.options.cacheNamespace), encodeURIComponent(this.operatorId)) : path.resolve('server/cache', this.operatorId);
    const zipPath = path.join(directory, "gtfs.zip");
    fs.mkdirSync(directory, { recursive: true });
    const fresh = fs.existsSync(zipPath) && Date.now() - fs.statSync(zipPath).mtimeMs < 6 * 3600_000;
    if (!fresh) {
      try { const source = await this.source(); await downloadFile({ url: source.url, headers: source.headers }, zipPath); this.stale = false; }
      catch (error) { if (!fs.existsSync(zipPath)) throw error; this.stale = true; }
    }
    const parsedPath = path.join(directory, 'parsed.v8');
    const today = formatServiceDate(new Date(), this.options.timezone);
    const serviceDates = [-1, 0, 1].map((delta) => shiftDate(today.date, delta));
    const now = Date.now();
    const cacheVariant = serviceDates.map(({ date }) => date).join(',') + ':' + Math.floor(now / (3 * 3600_000));
    this.receivedTimestamp = fs.statSync(zipPath).mtimeMs;
    const parsed = readParsedFeed(parsedPath, zipPath, cacheVariant);
    if (parsed) return parsed;
    const zip = new AdmZip(zipPath);
    // Only extract the known GTFS tables into this provider's cache directory.
    for (const table of ["routes", "trips", "stops", "stop_times", "shapes", "calendar", "calendar_dates", "frequencies"]) {
      const entry = zip.getEntry(`${table}.txt`);
      if (entry) fs.writeFileSync(path.join(directory, `${table}.txt`), entry.getData());
      else if (["calendar", "calendar_dates", "frequencies"].includes(table)) fs.rmSync(path.join(directory, `${table}.txt`), { force: true });
    }
    const gtfs = await parseGtfsDirectoryStreaming(directory, this.options.includeRoute, serviceDates, { from: now - 2 * 3600_000, to: now + 8 * 3600_000, timezone: this.options.timezone ?? 'Europe/Madrid' });
    await this.options.prepare?.(gtfs);
    if (!gtfs.routes.size || !gtfs.trips.size || !gtfs.shapes.size) throw new Error(`Incomplete GTFS for ${this.operatorId}`);
    writeParsedFeed(parsedPath, zipPath, gtfs, cacheVariant);
    console.log(`[${this.operatorId}] GTFS ready: ${gtfs.routes.size} routes, ${gtfs.trips.size} trips.`);
    return gtfs;
  }
  async getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    const gtfs = await this.getGtfs();
    return { operatorId: this.operatorId, fetchedAt: now.getTime(), sourceTimestamp: null, receivedTimestamp: this.receivedTimestamp, status: this.stale ? 'degraded' as const : 'ok' as const, vehicles: generateScheduledVehicles(gtfs, now, this.operatorId, this.options.timezone), ...(this.stale ? { error: 'Using the last available static timetable.' } : {}) };
  }
}
