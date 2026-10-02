export type EntityKind = 'vehicle' | 'route' | 'trip' | 'stop' | 'shape' | 'service' | 'place';
const kinds = new Set<EntityKind>(['vehicle', 'route', 'trip', 'stop', 'shape', 'service', 'place']);
/** Feed IDs can contain colons, percent signs and slashes. */
export function entityId(cityId: string, providerId: string, kind: EntityKind, externalId: string): string {
  if (!cityId || !providerId || !externalId) throw new Error('An entity requires city, provider and external identity');
  return [cityId, providerId, kind, externalId].map(encodeURIComponent).join(':');
}
export function parseEntityId(value: string): { cityId: string; providerId: string; kind: EntityKind; externalId: string } | null {
  const parts = value.split(':');
  if (parts.length !== 4) return null;
  try {
    const [cityId, providerId, kind, externalId] = parts.map(decodeURIComponent);
    return cityId && providerId && externalId && kinds.has(kind as EntityKind) ? { cityId, providerId, kind: kind as EntityKind, externalId } : null;
  } catch { return null; }
}
