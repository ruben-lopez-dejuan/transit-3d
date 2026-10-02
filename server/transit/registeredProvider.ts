import type { CityManifest, SourceAdapter, ProviderDefinition, ProviderHealth, TransitProvider, NormalizedProviderSnapshot } from '../../shared/transit/contracts';
import { isFresh } from '../../shared/transit/freshness';
import { normalizeVehicle } from './normalization';
/** Wrap existing adapters without changing their GPS or timetable algorithms. */
export class RegisteredProvider implements TransitProvider {
  readonly cityId: string; readonly operatorId: string; enabled = true; health: ProviderHealth;
  constructor(private readonly city: Pick<CityManifest, 'id' | 'timezone'>, readonly definition: ProviderDefinition, private readonly adapter: SourceAdapter) {
    if (definition.id !== adapter.operatorId) throw new Error('Provider definition does not match its adapter');
    this.cityId = city.id; this.operatorId = definition.id;
    this.health = { cityId: city.id, providerId: definition.id, state: 'unavailable', checkedTimestamp: 0, sourceTimestamp: null, receivedTimestamp: null, lastSuccessTimestamp: null };
  }
  async getSnapshot(now = new Date()): Promise<NormalizedProviderSnapshot> {
    const at = now.getTime();
    try {
      if (!this.enabled) throw new Error('Provider disabled');
      const raw = await this.adapter.getSnapshot(now);
      if (raw.operatorId !== this.operatorId) throw new Error('Adapter returned another provider identity');
      const sourceTimestamp = raw.sourceTimestamp === null ? null : raw.sourceTimestamp < 1e12 ? raw.sourceTimestamp * 1000 : raw.sourceTimestamp;
      const receivedTimestamp = raw.receivedTimestamp ?? null;
      const vehicles = raw.vehicles.flatMap((v) => { const normalized = normalizeVehicle(v, { cityId: this.cityId, providerId: this.operatorId, timezone: this.city.timezone }, receivedTimestamp, at); return normalized ? [normalized] : []; });
      const invalid = vehicles.length !== raw.vehicles.length;
      const stale = sourceTimestamp !== null && !isFresh(sourceTimestamp, at) || vehicles.some((v) => v.positionSource === 'STALE');
      const state = raw.status === 'unavailable' ? 'unavailable' : stale ? 'stale' : raw.status === 'degraded' || invalid ? 'degraded' : 'healthy';
      this.health = { cityId: this.cityId, providerId: this.operatorId, state, checkedTimestamp: at, sourceTimestamp, receivedTimestamp, lastSuccessTimestamp: raw.status === 'unavailable' ? this.health.lastSuccessTimestamp : at, ...(raw.error || invalid ? { error: raw.error ?? 'Invalid vehicles omitted during normalization' } : {}) };
      return { ...raw, cityId: this.cityId, providerId: this.operatorId, sourceTimestamp, receivedTimestamp, vehicles, status: state === 'healthy' ? 'ok' : state === 'unavailable' ? 'unavailable' : 'degraded', health: this.health, capabilities: this.definition.capabilities };
    } catch (error) {
      this.health = { ...this.health, state: 'unavailable', checkedTimestamp: at, error: error instanceof Error ? error.message : String(error) };
      return { cityId: this.cityId, providerId: this.operatorId, operatorId: this.operatorId, fetchedAt: at, sourceTimestamp: this.health.sourceTimestamp, receivedTimestamp: this.health.receivedTimestamp, vehicles: [], status: 'unavailable', error: this.health.error, health: this.health, capabilities: this.definition.capabilities };
    }
  }
}
