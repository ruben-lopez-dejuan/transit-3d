import type { RuntimeCityPackage } from '../../transit/cityPackage';
import { bilbaoManifest } from './city.manifest';
import { providers } from './providers';
import { infrastructureFor } from './infrastructure';
import { placeShortcuts } from './places';
import { entityId } from '../../../shared/transit/ids';
export const bilbaoCity: RuntimeCityPackage = {
  manifest: bilbaoManifest, providers,
  infrastructure: infrastructureFor,
  places: (stops) => placeShortcuts(stops).map((place) => ({ ...place, id: entityId(bilbaoManifest.id, 'city', 'place', place.id) })),
};
