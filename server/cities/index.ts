import { ProviderRegistry } from '../transit/registry';
import type { RuntimeCityPackage } from '../transit/cityPackage';
import { bilbaoCity } from './es-bilbao';
import { loadFolderCities } from './folderPackage';
import { CityExtensionRegistry } from './extensionRegistry';
import { madridExtensions } from './es-madrid';
export const cityRegistry = new ProviderRegistry<RuntimeCityPackage>();
cityRegistry.register(bilbaoCity);
export const cityExtensions = new CityExtensionRegistry();
cityExtensions.register('es-madrid', madridExtensions);
export const cityPackageReports = loadFolderCities(cityRegistry, undefined, cityExtensions);
for (const report of cityPackageReports) console[report.state === 'invalid' ? 'warn' : 'info'](`[city-packages] ${report.directory}: ${report.error ?? 'registrada'}`);
export const defaultCityId = bilbaoCity.manifest.id;
// Operational switch for tests/local maintenance; public HTTP clients cannot change it.
for (const id of (process.env.TRANSIT_DISABLED_PROVIDERS ?? '').split(',').map((v) => v.trim()).filter(Boolean)) cityRegistry.setProviderEnabled(defaultCityId, id, false);
