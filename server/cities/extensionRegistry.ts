import type { CityPackageConfig } from './packageConfig';
import type { ProviderExtension } from './folderPackage';
export type CityExtensionFactory = (config: CityPackageConfig) => ReadonlyMap<string, ProviderExtension>;
export class CityExtensionRegistry {
  private readonly factories = new Map<string, CityExtensionFactory>();
  register(cityId: string, factory: CityExtensionFactory) { if (this.factories.has(cityId)) throw new Error(`City extension already registered: ${cityId}`); this.factories.set(cityId, factory); }
  get(config: CityPackageConfig) { return this.factories.get(config.id)?.(config) ?? new Map<string, ProviderExtension>(); }
}
