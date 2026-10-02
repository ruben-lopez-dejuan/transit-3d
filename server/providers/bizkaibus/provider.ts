import { getBizkaibusProviderSnapshot } from "./service";
import type { TransitProvider, ProviderSnapshot } from "../../transit/types";

export class BizkaibusProvider implements TransitProvider {
  readonly operatorId = "bizkaibus";

  getSnapshot(now = new Date()): Promise<ProviderSnapshot> {
    return getBizkaibusProviderSnapshot(now);
  }
}
