import { getBizkaibusProviderSnapshot } from "./service";
import { getBizkaibusGtfs } from "./gtfs";
import { bizkaibusArrivals } from "./arrivals";
import type { TransitProvider, ProviderSnapshot } from "../../transit/types";

export class BizkaibusProvider implements TransitProvider {
  readonly operatorId = "bizkaibus";

  getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    // Passing times for the whole fleet refresh in the background; the snapshot never waits for them.
    void getBizkaibusGtfs().then((gtfs) => bizkaibusArrivals.refreshFleet(gtfs)).catch(() => {});
    return getBizkaibusProviderSnapshot(now);
  }
}
