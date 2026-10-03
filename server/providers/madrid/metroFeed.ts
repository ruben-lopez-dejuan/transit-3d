import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { downloadFile } from '../../lib/download';

export const METRO_TELEINDICADORES_URL = 'https://serviciosapp.metromadrid.es/servicios/rest/teleindicadores';
export type MetroBoard = { line: string; lineName?: string; station: string; stationId: string; platform: string; destination: string; sourceTimestamp: number; recordTimestamp: number | null; arrivals: number[] };
const xml = new XMLParser({ parseTagValue: false, processEntities: false, removeNSPrefix: true });
export function parseMetroBoards(text: string): MetroBoard[] {
  if (text.length > 2_000_000) throw new Error('Respuesta de teleindicadores inválida');
  const collection = xml.parse(text)?.VtelindicadoresCollection;
  if (!collection) throw new Error('Respuesta de teleindicadores inválida');
  const raw = collection.Vtelindicadores ?? [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((row) => {
    const instant = String(row.FECHAHORAEMISIONPREVISION ?? '');
    // Both source dates include an explicit offset. Never substitute HTTP receipt.
    const sourceTimestamp = /(?:Z|[+-]\d{2}:\d{2})$/.test(instant) ? Date.parse(instant) : NaN;
    if (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0 || !row.nombreest || !row.sentido || !/^\d+$/.test(String(row.linea))) return [];
    const arrivals = [row.proximo, row.siguiente].flatMap((value) => /^\d{1,2}$/.test(String(value)) && Number(value) <= 30 ? [sourceTimestamp + Number(value) * 60_000] : []);
    const record = Date.parse(String(row.FECHAHORAREGISTRO ?? ''));
    return [{ line: String(row.linea), lineName: String(row.nombreli ?? ''), station: String(row.nombreest).trim(), stationId: String(row.idnumerica ?? ''), platform: String(row.anden ?? ''), destination: String(row.sentido).trim(), sourceTimestamp, recordTimestamp: Number.isFinite(record) ? record : null, arrivals: [...new Set(arrivals)].sort((a, b) => a - b) }];
  });
}
export type MetroFeedState = { boards: MetroBoard[]; receivedTimestamp: number | null; error?: string };
export class MetroFeedClient {
  private state: MetroFeedState = { boards: [], receivedTimestamp: null };
  private pending?: Promise<void>;
  private expires = 0;
  private loaded = false;
  constructor(private readonly file = path.resolve('server/cache/madrid/teleindicadores.xml'), private readonly download = downloadFile) {}
  get(): MetroFeedState {
    if (!this.loaded) {
      this.loaded = true;
      if (fs.existsSync(this.file)) try { this.state.boards = parseMetroBoards(fs.readFileSync(this.file, 'utf8')); } catch { /* Invalid cache is never an observation. */ }
    }
    if (!this.pending && Date.now() >= this.expires) {
      this.expires = Date.now() + 30_000;
      this.pending = this.refresh().finally(() => { this.pending = undefined; this.expires = Date.now() + 30_000; });
    }
    return this.state;
  }
  private async refresh() {
    const candidate = this.file + '.' + process.pid + '.candidate';
    try {
      await this.download(METRO_TELEINDICADORES_URL, candidate);
      const boards = parseMetroBoards(fs.readFileSync(candidate, 'utf8'));
      fs.renameSync(candidate, this.file);
      this.state = { boards, receivedTimestamp: Date.now() };
    } catch { this.state = { ...this.state, error: 'No se pudo actualizar el feed oficial de teleindicadores.' }; }
    finally { try { fs.rmSync(candidate, { force: true }); } catch { /* Keep network/cache failures isolated. */ } }
  }
}
