import { ProviderRegistry } from '../transit/registry';
import type { RuntimeCityPackage } from '../transit/cityPackage';
import { bilbaoCity } from './es-bilbao';
export const cityRegistry = new ProviderRegistry<RuntimeCityPackage>();
cityRegistry.register(bilbaoCity);
export const defaultCityId = bilbaoCity.manifest.id;
// Operational switch for tests/local maintenance; public HTTP clients cannot change it.
for (const id of (process.env.TRANSIT_DISABLED_PROVIDERS ?? '').split(',').map((v) => v.trim()).filter(Boolean)) cityRegistry.setProviderEnabled(defaultCityId, id, false);
