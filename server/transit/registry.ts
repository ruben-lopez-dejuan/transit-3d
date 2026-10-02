import { CITY_PACKAGE_API_VERSION, type CityPackage } from '../../shared/transit/contracts';
/** Explicit registration. Package installation is a separate future feature. */
export class ProviderRegistry<T extends CityPackage = CityPackage> {
  private cities = new Map<string, T>();
  register(city: T) {
    const manifest = city.manifest;
    if (manifest.apiVersion !== CITY_PACKAGE_API_VERSION) throw new Error('Unsupported city package API version');
    if (this.cities.has(manifest.id)) throw new Error('City already registered: ' + manifest.id);
    new Intl.DateTimeFormat('en', { timeZone: manifest.timezone });
    const ids = new Set<string>();
    for (const provider of city.providers) {
      if (provider.cityId !== manifest.id || ids.has(provider.operatorId) || !manifest.providers.some((d) => d.id === provider.operatorId)) throw new Error('Invalid or duplicate city provider');
      ids.add(provider.operatorId);
    }
    if (ids.size !== manifest.providers.length) throw new Error('Manifest and runtime providers differ');
    this.cities.set(manifest.id, city); return city;
  }
  getCities() { return [...this.cities.values()].map((city) => city.manifest); }
  getCity(id: string) { return this.cities.get(id); }
  getProvidersForCity(id: string) { return this.getCity(id)?.providers ?? []; }
  getProviderHealth(cityId: string, providerId: string) { return this.getProvidersForCity(cityId).find((p) => p.operatorId === providerId)?.health; }
  setProviderEnabled(cityId: string, providerId: string, enabled: boolean) {
    const provider = this.getProvidersForCity(cityId).find((p) => p.operatorId === providerId);
    if (!provider) throw new Error('Unknown city provider');
    provider.enabled = enabled;
  }
}
