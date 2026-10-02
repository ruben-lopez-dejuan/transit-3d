import type { CityManifest } from '../../shared/transit/contracts';

export const CITY_STORAGE_KEY = 'transit:city';
/** URL wins over saved preference; a removed package safely falls back to the server default. */
export function chooseCityId(cities: readonly Pick<CityManifest, 'id'>[], requested: string | null, saved: string | null, defaultId: string): string {
  const exists = (id: string | null): id is string => !!id && cities.some((city) => city.id === id);
  const selected = [requested, saved, defaultId].find(exists) ?? cities[0]?.id;
  if (!selected) throw new Error('No hay ciudades disponibles.');
  return selected;
}
export function cityUrl(href: string, cityId: string) {
  const url = new URL(href);
  url.searchParams.set('city', cityId);
  return url.href;
}
