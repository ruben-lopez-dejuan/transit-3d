import type { NapSource, ResolvedSource } from './types';
export type NapFile = { id: number; nombreTipoFichero: string; esValido: boolean; tamanio: number; fechaActualizacion: string | null; fechaDesde: string | null; fechaHasta: string | null; numeroViajes: number; numeroRutas: number; numeroParadas: number };
export type NapDataset = { id: number; nombre: string; descripcion: string; fechaCreacion: string; ficheros: NapFile[]; organizacion?: { id: number; nombre: string }; operadores: { id: number; nombre: string; url?: string }[]; regiones: { id: number; nombre: string; idTipo: number; nombreTipo: string }[]; tiposTransporte: { id: number; nombre: string }[]; isObsolete: boolean };
type Envelope<T> = { success: boolean; data: T };
export class NapApiError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
export class NapClient {
  constructor(private readonly apiKey = process.env.NAP_API_KEY, private readonly baseUrl = 'https://nap.transportes.gob.es/api/v2', private readonly fetcher: typeof fetch = fetch) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.apiKey) throw new NapApiError('NAP_API_KEY no está configurada.');
    let response: Response;
    try { response = await this.fetcher(this.baseUrl + path, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000), headers: { Accept: 'application/json', ApiKey: this.apiKey, ...init.headers } }); }
    catch (error) { if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new NapApiError('NAP no respondió dentro del tiempo límite.'); throw error; }
    if (!response.ok) throw new NapApiError(response.status === 401 || response.status === 403 ? 'NAP rechazó la credencial.' : `NAP respondió HTTP ${response.status}.`, response.status);
    let body: Envelope<T>; try { body = await response.json() as Envelope<T>; } catch { throw new NapApiError('NAP devolvió una respuesta JSON inválida.'); }
    if (!body || body.success !== true || body.data === undefined) throw new NapApiError('NAP devolvió una respuesta incompleta.');
    return body.data;
  }
  getDataset(id: number) { return this.request<NapDataset>(`/conjunto-dato/${id}`); }
  getDatasets(regionId?: number) { return this.request<NapDataset[]>(regionId === undefined ? '/conjunto-dato?items=1000' : `/conjunto-dato/region/${regionId}`); }
  findRegions(name: string) { return this.request<{ id: number; nombre: string; tipo: string; tipoNombre: string }[]>(`/region/nombre/${encodeURIComponent(name)}`); }
  async resolve(source: NapSource): Promise<ResolvedSource> {
    const dataset = await this.getDataset(source.datasetId), file = dataset.ficheros.find((candidate) => candidate.id === source.fileId);
    if (!file) throw new NapApiError(`El fichero NAP ${source.fileId} no pertenece al conjunto ${source.datasetId}.`, 404);
    const data = await this.request<{ enlaceDescarga: string; nombreFichero: string; tipoContenido: string | null }>(`/fichero/${source.fileId}/descarga`);
    let url: URL; try { url = new URL(data.enlaceDescarga); } catch { throw new NapApiError('NAP devolvió un enlace de descarga inválido.'); }
    if (url.protocol !== 'https:') throw new NapApiError('NAP devolvió un enlace de descarga no seguro.');
    return { url: url.toString(), identity: `nap:${source.datasetId}:${source.fileId}`, temporary: true, metadata: { datasetId: dataset.id, fileId: file.id, fileName: data.nombreFichero, format: file.nombreTipoFichero, updatedAt: file.fechaActualizacion, validFrom: file.fechaDesde, validTo: file.fechaHasta } };
  }
}
