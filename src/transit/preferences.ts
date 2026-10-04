import type { TransitMode } from './networkTypes';

export type MapCamera = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

export type CityPreferences = {
  mode?: TransitMode | 'all';
  operators?: string[];
  disabledLayers?: string[];
  underground?: boolean;
  camera?: MapCamera;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const MODES = new Set(['all', 'bus', 'rail', 'tram', 'funicular']);
export const cityPreferencesKey = (cityId: string) => `transit:city:${cityId}:preferences:v1`;

function strings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length <= 300))] : undefined;
}

export function parseCityPreferences(value: unknown): CityPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: CityPreferences = {};
  if (typeof source.mode === 'string' && MODES.has(source.mode)) result.mode = source.mode as CityPreferences['mode'];
  const operators = strings(source.operators); if (operators) result.operators = operators;
  const disabledLayers = strings(source.disabledLayers); if (disabledLayers) result.disabledLayers = disabledLayers;
  if (typeof source.underground === 'boolean') result.underground = source.underground;
  const camera = source.camera as Record<string, unknown> | undefined;
  const center = camera?.center;
  if (Array.isArray(center) && center.length === 2 && center.every(Number.isFinite)
    && Number.isFinite(camera?.zoom) && Number(camera!.zoom) >= 0 && Number(camera!.zoom) <= 24
    && Number.isFinite(camera?.bearing) && Number.isFinite(camera?.pitch) && Number(camera!.pitch) >= 0 && Number(camera!.pitch) <= 65) {
    result.camera = { center: [Number(center[0]), Number(center[1])], zoom: Number(camera!.zoom), bearing: Number(camera!.bearing), pitch: Number(camera!.pitch) };
  }
  return result;
}

export function readCityPreferences(cityId: string, storage: StorageLike): CityPreferences {
  try { return parseCityPreferences(JSON.parse(storage.getItem(cityPreferencesKey(cityId)) ?? '{}')); }
  catch { return {}; }
}

export function writeCityPreferences(cityId: string, preferences: CityPreferences, storage: StorageLike) {
  try { storage.setItem(cityPreferencesKey(cityId), JSON.stringify(parseCityPreferences(preferences))); }
  catch { /* Storage can be unavailable in private browsing. */ }
}
