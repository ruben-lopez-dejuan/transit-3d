export type DirectHttpSource = { type: 'http'; url: string };
export type NapSource = { type: 'nap'; datasetId: number; fileId: number };
export type SourceDescriptor = DirectHttpSource | NapSource;
export type ResolvedSource = { url: string; headers?: Readonly<Record<string, string>>; identity: string; temporary: boolean; metadata?: { datasetId?: number; fileId?: number; fileName?: string; format?: string; updatedAt?: string | null; validFrom?: string | null; validTo?: string | null } };
export type SourceResolver = { resolve(source: SourceDescriptor): Promise<ResolvedSource> };
export type SourceSupplier = () => Promise<ResolvedSource>;
export const directSource = (url: string): DirectHttpSource => ({ type: 'http', url });
export const sourceIdentity = (source: SourceDescriptor) => source.type === 'http' ? `http:${source.url}` : `nap:${source.datasetId}:${source.fileId}`;
