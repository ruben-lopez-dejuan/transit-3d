import type { NormalizedProviderSnapshot, TransitProvider, NormalizedVehicle } from '../../shared/transit/contracts';

export type TransitSnapshot = {
  fetchedAt: number;
  vehicles: NormalizedVehicle[];
  providers: NormalizedProviderSnapshot[];
};

export class TransitEngine {
  constructor(private readonly providers: readonly TransitProvider[]) {}

  async getSnapshot(now = new Date(), blocked: ReadonlyMap<string, 'loading' | 'unavailable'> = new Map()): Promise<TransitSnapshot> {
    const snapshots = await Promise.all(this.providers.map(async (provider): Promise<NormalizedProviderSnapshot> => {
      const started = performance.now();
      const reason = blocked.get(provider.operatorId);
      if (reason) return {
        operatorId: provider.operatorId, providerId: provider.operatorId, cityId: provider.cityId,
        fetchedAt: now.getTime(), sourceTimestamp: null, receivedTimestamp: null, vehicles: [],
        status: reason === 'loading' ? 'degraded' : 'unavailable', capabilities: provider.definition.capabilities,
        health: { ...provider.health, state: reason === 'loading' ? 'degraded' : 'unavailable', checkedTimestamp: now.getTime() },
        error: reason === 'loading' ? 'Preparando datos del operador.' : 'Catálogo del operador no disponible.',
      };
      try {
        const snapshot = await provider.getSnapshot(now);
        if (process.env.TRANSIT_PROFILE === '1') console.log(`[profile] ${provider.operatorId} ${Math.round(performance.now() - started)} ms; ${snapshot.vehicles.length} vehicles`);
        return snapshot;
      } catch (error) {
        return {
          operatorId: provider.operatorId,
          providerId: provider.operatorId,
          cityId: provider.cityId,
          fetchedAt: now.getTime(),
          sourceTimestamp: null,
          receivedTimestamp: null,
          vehicles: [],
          status: "unavailable" as const,
          capabilities: provider.definition.capabilities,
          health: { ...provider.health, state: 'unavailable', checkedTimestamp: now.getTime() },
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const vehicles = new Map<string, NormalizedVehicle>();
    for (const provider of snapshots) for (const vehicle of provider.vehicles) vehicles.set(vehicle.id, vehicle);
    return { fetchedAt: now.getTime(), vehicles: [...vehicles.values()], providers: snapshots };
  }
}
