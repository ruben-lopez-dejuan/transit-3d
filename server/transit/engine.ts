import type { ProviderSnapshot, TransitProvider, TransitVehicle } from "./types";

export type TransitSnapshot = {
  fetchedAt: number;
  vehicles: TransitVehicle[];
  providers: ProviderSnapshot[];
};

export class TransitEngine {
  constructor(private readonly providers: TransitProvider[]) {}

  async getSnapshot(now = new Date()): Promise<TransitSnapshot> {
    const snapshots = await Promise.all(this.providers.map(async (provider) => {
      const started = performance.now();
      try {
        const snapshot = await provider.getSnapshot(now);
        if (process.env.TRANSIT_PROFILE === '1') console.log(`[profile] ${provider.operatorId} ${Math.round(performance.now() - started)} ms; ${snapshot.vehicles.length} vehicles`);
        return snapshot;
      } catch (error) {
        return {
          operatorId: provider.operatorId,
          fetchedAt: now.getTime(),
          sourceTimestamp: null,
          vehicles: [],
          status: "unavailable" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const vehicles = new Map<string, TransitVehicle>();
    for (const provider of snapshots) for (const vehicle of provider.vehicles) vehicles.set(vehicle.id, vehicle);
    return { fetchedAt: now.getTime(), vehicles: [...vehicles.values()], providers: snapshots };
  }
}
