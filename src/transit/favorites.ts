import type { Network } from './networkTypes';

/** Migrate persisted local references only when the loaded catalog identifies them. */
export function migrateFavorites(saved: ReadonlySet<string>, network: Pick<Network, 'routes' | 'stops'>): Set<string> {
  const replacements = new Map<string, string>();
  for (const route of network.routes) replacements.set(`route:${route.operatorId}:${route.externalId}`, `route:${route.key}`);
  for (const stop of network.stops) replacements.set(`stop:${stop.operatorId}:${stop.externalId}`, `stop:${stop.key}`);
  return new Set([...saved].map((key) => replacements.get(key) ?? key));
}
