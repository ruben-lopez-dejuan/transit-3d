import { getBizkaibusGtfs } from "./providers/bizkaibus/gtfs";

async function main() {
  const gtfs = await getBizkaibusGtfs();

  console.log("Routes:", gtfs.routes.size);
  console.log("Trips:", gtfs.trips.size);
  console.log("Shapes:", gtfs.shapes.size);
  console.log("Stops:", gtfs.stops.size);
  console.log(
    "Trips with stop data:",
    gtfs.tripStops.size,
  );
  console.log("Calendars:", gtfs.calendars.size);
  console.log(
    "Calendar date exceptions:",
    [...gtfs.calendarDates.values()].reduce((total, dates) => total + dates.size, 0),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
