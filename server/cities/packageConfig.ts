import { CITY_PACKAGE_API_VERSION, type CityManifest, type TransitMode, type VehicleAppearance } from '../../shared/transit/contracts';

/** Data-only installation contract: downloaded city packages never execute code. */
export type CityPackageConfig = Omit<CityManifest, 'providers'> & {
  providers: {
    id: string; name: string; color: string; primary?: boolean; group?: string;
    sources: { gtfs: string; tripUpdates?: string; vehiclePositions?: string };
    routeIds?: string[]; maximumGpsSpeed?: number; appearance?: VehicleAppearance;
  }[];
};
const modes: TransitMode[] = ['bus', 'rail', 'tram', 'funicular', 'unknown'];
function fail(at: string, message: string): never { throw new Error(`${at}: ${message}`); }
function object(value: unknown, at: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at, 'debe ser un objeto');
  const row = value as Record<string, unknown>;
  for (const field of required) if (!(field in row)) fail(`${at}.${field}`, 'campo obligatorio');
  for (const field of Object.keys(row)) if (![...required, ...optional].includes(field)) fail(`${at}.${field}`, 'campo no soportado');
  return row;
}
function string(value: unknown, at: string, pattern?: RegExp) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || (pattern && !pattern.test(value))) fail(at, 'texto no válido');
  return value;
}
function number(value: unknown, at: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(at, `número entre ${min} y ${max}`);
  return value;
}
function list(value: unknown, at: string, max = 10000): unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > max) fail(at, 'lista no vacía dentro del límite permitido');
  return value;
}
function coordinate(value: unknown, at: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail(at, 'se espera [longitud, latitud]');
  return [number(value[0], `${at}[0]`, -180, 180), number(value[1], `${at}[1]`, -90, 90)];
}
function url(value: unknown, at: string) {
  const text = string(value, at);
  let parsed: URL;
  try { parsed = new URL(text); } catch { return fail(at, 'URL no válida'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail(at, 'se requiere HTTPS público, sin credenciales ni fragmento');
}
export function parseCityPackage(value: unknown): CityPackageConfig {
  const root = object(value, 'city', ['apiVersion', 'id', 'countryCode', 'name', 'region', 'timezone', 'center', 'bounds', 'modes', 'presentation', 'providers']);
  if (root.apiVersion !== CITY_PACKAGE_API_VERSION) fail('city.apiVersion', 'versión incompatible; se requiere 1');
  string(root.id, 'city.id', /^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const country = string(root.countryCode, 'city.countryCode', /^[A-Z]{2}$/);
  if (!(root.id as string).startsWith(country.toLowerCase() + '-')) fail('city.id', 'el prefijo debe corresponder a countryCode');
  for (const key of ['name', 'region', 'timezone']) string(root[key], `city.${key}`);
  try { new Intl.DateTimeFormat('en', { timeZone: root.timezone as string }); } catch { fail('city.timezone', 'zona horaria no válida'); }
  const center = coordinate(root.center, 'city.center');
  if (!Array.isArray(root.bounds) || root.bounds.length !== 2) fail('city.bounds', 'se requieren dos esquinas');
  const sw = coordinate(root.bounds[0], 'city.bounds[0]'), ne = coordinate(root.bounds[1], 'city.bounds[1]');
  if (sw[0] >= ne[0] || sw[1] >= ne[1] || center.some((v, i) => v < sw[i] || v > ne[i])) fail('city.bounds', 'límites ordenados y centro dentro de ellos');
  const transport = list(root.modes, 'city.modes', modes.length);
  if (transport.some((mode) => !modes.includes(mode as TransitMode)) || new Set(transport).size !== transport.length) fail('city.modes', 'modos no válidos o repetidos');
  const presentation = object(root.presentation, 'city.presentation', ['title', 'mapLabel', 'searchLabel', 'initialZoom', 'brandMark']);
  for (const key of ['title', 'mapLabel', 'searchLabel', 'brandMark']) string(presentation[key], `city.presentation.${key}`);
  number(presentation.initialZoom, 'city.presentation.initialZoom', 0, 20);
  const ids = new Set<string>();
  for (const [index, item] of list(root.providers, 'city.providers', 100).entries()) {
    const at = `city.providers[${index}]`;
    const provider = object(item, at, ['id', 'name', 'color', 'sources'], ['primary', 'group', 'routeIds', 'maximumGpsSpeed', 'appearance']);
    const id = string(provider.id, `${at}.id`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    if (ids.has(id)) fail(`${at}.id`, 'operador repetido');
    ids.add(id); string(provider.name, `${at}.name`); string(provider.color, `${at}.color`, /^#[0-9a-fA-F]{6}$/);
    if (provider.primary !== undefined && typeof provider.primary !== 'boolean') fail(`${at}.primary`, 'debe ser boolean');
    if (provider.group !== undefined) string(provider.group, `${at}.group`);
    const sources = object(provider.sources, `${at}.sources`, ['gtfs'], ['tripUpdates', 'vehiclePositions']);
    for (const [key, source] of Object.entries(sources)) url(source, `${at}.sources.${key}`);
    if (provider.routeIds !== undefined) {
      const routes = list(provider.routeIds, `${at}.routeIds`);
      for (const route of routes) string(route, `${at}.routeIds`);
      if (new Set(routes).size !== routes.length) fail(`${at}.routeIds`, 'IDs repetidos');
    }
    if (provider.maximumGpsSpeed !== undefined) number(provider.maximumGpsSpeed, `${at}.maximumGpsSpeed`, 1, 120);
    if (provider.appearance !== undefined) {
      const appearance = object(provider.appearance, `${at}.appearance`, ['kind', 'composition', 'lateralOffsetMeters']);
      if (!['bus', 'train', 'metro', 'tram', 'funicular', 'unknown'].includes(appearance.kind as string)) fail(`${at}.appearance.kind`, 'modelo no válido');
      const composition = object(appearance.composition, `${at}.appearance.composition`, ['count', 'length', 'gap']);
      const count = number(composition.count, `${at}.appearance.composition.count`, 1, 16);
      if (!Number.isInteger(count)) fail(`${at}.appearance.composition.count`, 'se requiere un entero');
      number(composition.length, `${at}.appearance.composition.length`, 1, 40);
      number(composition.gap, `${at}.appearance.composition.gap`, 0, 10);
      number(appearance.lateralOffsetMeters, `${at}.appearance.lateralOffsetMeters`, 0, 10);
    }
  }
  return structuredClone(value) as CityPackageConfig;
}
