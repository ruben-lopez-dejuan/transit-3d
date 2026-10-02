import assert from "node:assert/strict";
import test from "node:test";
import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { formatServiceDate, getActiveTrips, isServiceActive, parseGtfsTime } from "./gtfsCalendar";
import { bearingDegrees, buildShapeMetric, correctedProgress, interpolateProgress, positionAtProgress, projectOntoShape } from "./motionEngine";
import { generateScheduledVehicles } from "./scheduled";
import { TransitEngine } from "./engine";

test("calendar_dates adds and removes service, overriding the weekly calendar", () => {
  const gtfs = {
    calendars: new Map([["weekday", { serviceId: "weekday", weekdays: [true, true, true, true, true, false, false], startDate: "20260101", endDate: "20261231" }]]),
    calendarDates: new Map<string, Map<string, 1 | 2>>([["weekday", new Map([["20261002", 2]])], ["special", new Map([["20261003", 1]])]]),
  } as Pick<BizkaibusGtfs, "calendars" | "calendarDates">;
  assert.equal(isServiceActive(gtfs, "weekday", "20261002", 4), false);
  assert.equal(isServiceActive(gtfs, "weekday", "20261003", 5), false);
  assert.equal(isServiceActive(gtfs, "special", "20261003", 5), true);
});

test("active trips are selected by service date and exceptions", () => {
  const gtfs = {
    trips: new Map([
      ["a", { tripId: "a", routeId: "r", serviceId: "weekday", shapeId: "s", headsign: "", directionId: null }],
      ["b", { tripId: "b", routeId: "r", serviceId: "special", shapeId: "s", headsign: "", directionId: null }],
    ]),
    calendars: new Map([["weekday", { serviceId: "weekday", weekdays: [true, true, true, true, true, false, false], startDate: "20260101", endDate: "20261231" }]]),
    calendarDates: new Map<string, Map<string, 1 | 2>>([["weekday", new Map([["20261002", 2]])], ["special", new Map([["20261002", 1]])]]),
  } as Pick<BizkaibusGtfs, "trips" | "calendars" | "calendarDates">;
  assert.deepEqual(getActiveTrips(gtfs, "20261002", 4).map((trip) => trip.tripId), ["b"]);
});

test("GTFS date, service-day times and extended-hour values are interpreted correctly", () => {
  assert.deepEqual(formatServiceDate(new Date("2026-10-02T10:00:00Z")), { date: "20261002", weekday: 4 });
  assert.equal(parseGtfsTime("25:10:05"), 90_605);
  assert.equal(parseGtfsTime("12:60:00"), null);
});

test("shape metric supports distance interpolation, projection and bearing", () => {
  const metric = buildShapeMetric([
    { longitude: 0, latitude: 0, sequence: 1 },
    { longitude: 0.001, latitude: 0, sequence: 2 },
    { longitude: 0.001, latitude: 0.001, sequence: 3 },
  ]);
  const halfway = positionAtProgress(metric, metric.cumulativeMeters[1] / 2)!;
  assert.ok(Math.abs(halfway.coordinate[0] - 0.0005) < 1e-8);
  assert.ok(Math.abs(halfway.bearing - 90) < 0.1);
  const projection = projectOntoShape(metric, [0.0005, 0.00001])!;
  assert.ok(Math.abs(projection.progressMeters - metric.cumulativeMeters[1] / 2) < 1);
  assert.ok(projection.distanceMeters < 2);
  assert.ok(Math.abs(bearingDegrees([0, 0], [0.001, 0]) - 90) < 0.1);
});

test("motion advances on progress and eases GPS corrections", () => {
  assert.equal(interpolateProgress(0, 100, 0, 10_000, 5_000), 50);
  assert.equal(correctedProgress(40, 100, 5_000), 70);
  assert.equal(correctedProgress(40, 100, 15_000), 100);
});

test("scheduled trips get a shape-based position and honest quality", () => {
  const gtfs = {
    routes: new Map([["metro-line", { routeId: "metro-line", shortName: "L1", longName: "", color: "", textColor: "", routeType: 1 }]]),
    trips: new Map([["trip-1", { tripId: "trip-1", routeId: "metro-line", serviceId: "weekday", shapeId: "shape-1", headsign: "Plentzia", directionId: 0 }]]),
    shapes: new Map([["shape-1", [{ longitude: 0, latitude: 0, sequence: 1 }, { longitude: 0.01, latitude: 0, sequence: 2 }, { longitude: 0.02, latitude: 0, sequence: 3 }]]]),
    stops: new Map([
      ["s1", { stopId: "s1", stopCode: "", name: "A", longitude: 0, latitude: 0 }],
      ["s2", { stopId: "s2", stopCode: "", name: "B", longitude: 0.01, latitude: 0 }],
      ["s3", { stopId: "s3", stopCode: "", name: "C", longitude: 0.02, latitude: 0 }],
    ]),
    tripStops: new Map([["trip-1", [
      { stopId: "s1", sequence: 1, arrivalTime: "09:00:00", departureTime: "09:00:00" },
      { stopId: "s2", sequence: 2, arrivalTime: "10:00:00", departureTime: "10:10:00" },
      { stopId: "s3", sequence: 3, arrivalTime: "11:00:00", departureTime: "11:00:00" },
    ]]]),
    routeTripIds: new Map(),
    calendars: new Map([["weekday", { serviceId: "weekday", weekdays: [true, true, true, true, true, false, false], startDate: "20260101", endDate: "20261231" }]]),
    calendarDates: new Map(),
  } as BizkaibusGtfs;
  const now = new Date("2026-05-04T08:05:00Z");
  const [vehicle] = generateScheduledVehicles(gtfs, now, "metro");
  assert.ok(vehicle);
  assert.equal(vehicle.positionQuality, "scheduled");
  assert.equal(vehicle.mode, "rail");
  assert.ok(Math.abs(vehicle.longitude - 0.01) < 0.0001);
  assert.equal(vehicle.observationTimestamp, null);
});

test("TransitEngine combines normalized provider snapshots and isolates provider failures", async () => {
  const engine = new TransitEngine([
    {
      operatorId: "good",
      getSnapshot: async (now = new Date()) => ({
        operatorId: "good", fetchedAt: now.getTime(), sourceTimestamp: now.getTime(), status: "ok" as const,
        vehicles: [{ id: "good:trip", operatorId: "good", mode: "bus" as const, tripId: "trip", routeId: "r", directionId: null, shapeId: "s", progressMetersAlongShape: 25, latitude: 0, longitude: 0, bearing: 90, positionQuality: "live" as const, observationTimestamp: now.getTime(), predictionTimestamp: now.getTime(), delaySeconds: null }],
      }),
    },
    { operatorId: "offline", getSnapshot: async () => { throw new Error("feed down"); } },
  ]);
  const snapshot = await engine.getSnapshot(new Date("2026-10-02T10:00:00Z"));
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.vehicles[0].positionQuality, "live");
  assert.equal(snapshot.providers[1].status, "unavailable");
  assert.equal(snapshot.providers[1].error, "feed down");
});
