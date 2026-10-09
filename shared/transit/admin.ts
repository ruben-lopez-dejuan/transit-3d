import type { CityManifest, PositionQuality, PositionSource, ProviderCapabilities, ProviderHealth, TransitMode } from './contracts';

export type AdminFinding = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export type AdminCatalogDiagnostics = {
  providerId: string;
  state: 'disabled' | 'loading' | 'ready' | 'error';
  routes: number;
  trips: number;
  stops: number;
  shapes: number;
  services: number;
  error?: string;
};

export type AdminVehicleSample = {
  id: string;
  route: string;
  destination: string;
  mode: TransitMode;
  positionSource: PositionSource;
  positionQuality: PositionQuality;
  sourceTimestamp: number | null;
  receivedTimestamp: number | null;
  latitude: number;
  longitude: number;
};

export type AdminProviderDiagnostics = {
  id: string;
  name: string;
  color: string;
  group?: string;
  primary?: boolean;
  enabled: boolean;
  loading: boolean;
  status: 'ok' | 'degraded' | 'stale' | 'unavailable' | 'not_checked';
  capabilities: ProviderCapabilities;
  catalog: AdminCatalogDiagnostics;
  vehicles: {
    total: number;
    byPositionSource: Record<PositionSource, number>;
    byQuality: Record<PositionQuality, number>;
    byMode: Partial<Record<TransitMode, number>>;
  };
  realtimeTripCount: number;
  realtimeArrivalCount: number;
  timestamps: {
    fetched: number | null;
    source: number | null;
    received: number | null;
    checked: number | null;
    lastSuccess: number | null;
  };
  health: ProviderHealth;
  error?: string;
  findings: AdminFinding[];
  samples: AdminVehicleSample[];
};

export type AdminCityIndex = {
  id: string;
  name: string;
  region: string;
  initialized: boolean;
  providers: number;
  checkedProviders: number;
  problemProviders: number;
};

export type AdminCityDiagnostics = {
  generatedAt: number;
  city: CityManifest;
  providers: AdminProviderDiagnostics[];
  totals: {
    providers: number;
    readyCatalogs: number;
    vehicles: number;
    gps: number;
    providerEstimated: number;
    scheduled: number;
    stale: number;
    issues: number;
  };
  process: {
    uptimeSeconds: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    rssBytes: number;
  };
};
