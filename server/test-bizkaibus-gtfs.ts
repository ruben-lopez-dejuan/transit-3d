import { getBizkaibusGtfs } from "./providers/bizkaibus/gtfs";

async function main() {
  const gtfs = await getBizkaibusGtfs();

  console.log("Routes:", gtfs.routes.size);
  console.log("Trips:", gtfs.trips.size);
  console.log("Shapes:", gtfs.shapes.size);
  console.log("Stops:", gtfs.stops.size);
  console.log("Trips with stop data:", gtfs.tripStops.size);

  const knownTrip =
    "trp_A3411_806_OP9LSEPT_62700_O9LJI3411_341141_10";

  console.log("");
  console.log("Known realtime trip:");
  console.dir(
    gtfs.trips.get(knownTrip) ?? "not present in current static GTFS",
    { depth: null },
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
