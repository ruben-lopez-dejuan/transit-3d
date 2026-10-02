import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { downloadFile } from "../lib/download";
import { parseGtfsDirectory, type BizkaibusGtfs, type GtfsRoute } from "./bizkaibus/gtfs";
import { generateScheduledVehicles } from "../transit/scheduled";
import type { TransitProvider, ProviderSnapshot } from "../transit/types";

export class StaticGtfsProvider implements TransitProvider {
  private data: Promise<BizkaibusGtfs> | null = null;
  private stale = false;
  constructor(readonly operatorId: string, private readonly url: string, private readonly options: { includeRoute?: (route: GtfsRoute) => boolean; prepare?: (gtfs: BizkaibusGtfs) => void } = {}) {}
  getGtfs(): Promise<BizkaibusGtfs> {
    if (!this.data) this.data = this.load().catch((error) => { this.data = null; throw error; });
    return this.data;
  }
  private async load() {
    const directory = path.resolve("server/cache", this.operatorId);
    const zipPath = path.join(directory, "gtfs.zip");
    fs.mkdirSync(directory, { recursive: true });
    const fresh = fs.existsSync(zipPath) && Date.now() - fs.statSync(zipPath).mtimeMs < 6 * 3600_000;
    if (!fresh) {
      try { await downloadFile(this.url, zipPath); }
      catch (error) { if (!fs.existsSync(zipPath)) throw error; this.stale = true; }
    }
    const zip = new AdmZip(zipPath);
    // Only extract the known GTFS tables into this provider's cache directory.
    for (const table of ["routes", "trips", "stops", "stop_times", "shapes", "calendar", "calendar_dates"]) {
      const entry = zip.getEntry(`${table}.txt`);
      if (entry) fs.writeFileSync(path.join(directory, `${table}.txt`), entry.getData());
      else if (["calendar", "calendar_dates"].includes(table)) fs.rmSync(path.join(directory, `${table}.txt`), { force: true });
    }
    const gtfs = parseGtfsDirectory(directory, this.options.includeRoute);
    this.options.prepare?.(gtfs);
    if (!gtfs.routes.size || !gtfs.trips.size || !gtfs.shapes.size) throw new Error(`Incomplete GTFS for ${this.operatorId}`);
    console.log(`[${this.operatorId}] GTFS ready: ${gtfs.routes.size} routes, ${gtfs.trips.size} trips.`);
    return gtfs;
  }
  async getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    const gtfs = await this.getGtfs();
    return { operatorId: this.operatorId, fetchedAt: now.getTime(), sourceTimestamp: null, status: this.stale ? "degraded" as const : "ok" as const, vehicles: generateScheduledVehicles(gtfs, now, this.operatorId), ...(this.stale ? { error: "Using the last available static timetable." } : {}) };
  }
}
