import {
  getActiveRoutes,
  getBizkaibusSnapshot,
} from "./providers/bizkaibus/service";

async function main() {
  const snapshot = await getBizkaibusSnapshot();
  const routes = await getActiveRoutes();

  console.log(
    "Feed timestamp:",
    snapshot.feedTimestamp,
  );
  console.log(
    "Raw realtime vehicles:",
    snapshot.rawVehicleCount,
  );
  console.log(
    "Valid mapped vehicles:",
    snapshot.validVehicleCount,
  );
  console.log(
    "Rejected positions:",
    snapshot.rejectedVehicleCount,
  );
  console.log(
    "Unmatched trips:",
    snapshot.unmatchedTripCount,
  );
  console.log(
    "Active routes:",
    routes.length,
  );

  console.log("");
  console.log("First valid vehicle:");
  console.dir(snapshot.vehicles[0] ?? null, {
    depth: null,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
