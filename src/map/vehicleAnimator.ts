import type { GeoJSONSource } from "maplibre-gl";

import type { LiveVehicle } from "../transit/types";

type VehicleState = {
  current: [number, number];
  from: [number, number];
  target: [number, number];

  bearingCurrent: number;
  bearingFrom: number;
  bearingTarget: number;

  startedAt: number;
  duration: number;
};

const BUS_LENGTH_METERS = 12;
const BUS_WIDTH_METERS = 2.55;

function shortestAngleDelta(
  from: number,
  to: number,
) {
  return ((to - from + 540) % 360) - 180;
}

function normaliseBearing(
  bearing: number,
) {
  return ((bearing % 360) + 360) % 360;
}

function offsetCoordinate(
  center: [number, number],
  forwardMeters: number,
  rightMeters: number,
  bearingDegrees: number,
): [number, number] {
  const [longitude, latitude] = center;

  const angle =
    bearingDegrees *
    Math.PI /
    180;

  // Bearing 0 = norte.
  const eastMeters =
    forwardMeters * Math.sin(angle) +
    rightMeters * Math.cos(angle);

  const northMeters =
    forwardMeters * Math.cos(angle) -
    rightMeters * Math.sin(angle);

  const latitudeRadians =
    latitude *
    Math.PI /
    180;

  const metersPerLongitudeDegree =
    111_320 *
    Math.cos(latitudeRadians);

  const metersPerLatitudeDegree =
    110_540;

  return [
    longitude +
      eastMeters /
        metersPerLongitudeDegree,

    latitude +
      northMeters /
        metersPerLatitudeDegree,
  ];
}

function createBusPolygon(
  center: [number, number],
  bearing: number,
) {
  const halfLength =
    BUS_LENGTH_METERS / 2;

  const halfWidth =
    BUS_WIDTH_METERS / 2;

  const frontLeft =
    offsetCoordinate(
      center,
      halfLength,
      -halfWidth,
      bearing,
    );

  const frontRight =
    offsetCoordinate(
      center,
      halfLength,
      halfWidth,
      bearing,
    );

  const rearRight =
    offsetCoordinate(
      center,
      -halfLength,
      halfWidth,
      bearing,
    );

  const rearLeft =
    offsetCoordinate(
      center,
      -halfLength,
      -halfWidth,
      bearing,
    );

  return [
    frontLeft,
    frontRight,
    rearRight,
    rearLeft,
    frontLeft,
  ];
}

export class VehicleAnimator {
  private states =
    new Map<string, VehicleState>();

  private latestVehicles =
    new Map<string, LiveVehicle>();

  private animationFrame:
    number | null = null;

  constructor(
    private readonly pointSource:
      GeoJSONSource,

    private readonly bodySource:
      GeoJSONSource,
  ) {}

  start() {
    if (
      this.animationFrame !== null
    ) {
      return;
    }

    const animate = () => {
      const now =
        performance.now();

      const pointFeatures = [];
      const bodyFeatures = [];

      for (
        const [id, state]
        of this.states
      ) {
        const rawProgress =
          Math.min(
            1,
            Math.max(
              0,
              (
                now -
                state.startedAt
              ) /
                state.duration,
            ),
          );

        const progress =
          1 -
          Math.pow(
            1 - rawProgress,
            3,
          );

        state.current = [
          state.from[0] +
            (
              state.target[0] -
              state.from[0]
            ) *
              progress,

          state.from[1] +
            (
              state.target[1] -
              state.from[1]
            ) *
              progress,
        ];

        state.bearingCurrent =
          state.bearingFrom +
          (
            state.bearingTarget -
            state.bearingFrom
          ) *
            progress;

        const vehicle =
          this.latestVehicles.get(
            id,
          );

        if (!vehicle) continue;

        const bearing =
          normaliseBearing(
            state.bearingCurrent,
          );

        const color =
          `#${
            vehicle.routeColor
              .replace("#", "")
          }`;

        pointFeatures.push({
          type: "Feature" as const,
          id,

          properties: {
            vehicleId:
              vehicle.vehicleId ?? "",

            routeShortName:
              vehicle.routeShortName,

            headsign:
              vehicle.headsign,

            stopName:
              vehicle.stopName ?? "",

            timestamp:
              vehicle.timestamp ?? 0,

            bearing,

            distanceToShapeMeters:
              vehicle.distanceToShapeMeters,
          },

          geometry: {
            type: "Point" as const,
            coordinates:
              state.current,
          },
        });

        bodyFeatures.push({
          type: "Feature" as const,
          id: `body-${id}`,

          properties: {
            color,
            bearing,
            routeShortName:
              vehicle.routeShortName,
          },

          geometry: {
            type: "Polygon" as const,

            coordinates: [
              createBusPolygon(
                state.current,
                bearing,
              ),
            ],
          },
        });
      }

      this.pointSource.setData({
        type: "FeatureCollection",
        features:
          pointFeatures,
      });

      this.bodySource.setData({
        type: "FeatureCollection",
        features:
          bodyFeatures,
      });

      this.animationFrame =
        requestAnimationFrame(
          animate,
        );
    };

    this.animationFrame =
      requestAnimationFrame(
        animate,
      );
  }

  stop() {
    if (
      this.animationFrame !== null
    ) {
      cancelAnimationFrame(
        this.animationFrame,
      );

      this.animationFrame =
        null;
    }
  }

  clear() {
    this.states.clear();

    this.latestVehicles.clear();

    this.pointSource.setData({
      type: "FeatureCollection",
      features: [],
    });

    this.bodySource.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  update(
    vehicles: LiveVehicle[],
  ) {
    const now =
      performance.now();

    const seen =
      new Set<string>();

    this.latestVehicles =
      new Map(
        vehicles.map(
          (vehicle) => [
            vehicle.vehicleId ||
              vehicle.entityId,

            vehicle,
          ],
        ),
      );

    for (
      const vehicle
      of vehicles
    ) {
      const id =
        vehicle.vehicleId ||
        vehicle.entityId;

      seen.add(id);

      const target:
        [number, number] = [
          vehicle.longitude,
          vehicle.latitude,
        ];

      const targetBearing =
        vehicle.bearing || 0;

      const existing =
        this.states.get(id);

      if (!existing) {
        this.states.set(
          id,
          {
            current: target,
            from: target,
            target,

            bearingCurrent:
              targetBearing,

            bearingFrom:
              targetBearing,

            bearingTarget:
              targetBearing,

            startedAt: now,

            duration: 4_300,
          },
        );

        continue;
      }

      existing.from = [
        ...existing.current,
      ];

      existing.target =
        target;

      existing.startedAt =
        now;

      existing.duration =
        4_300;

      existing.bearingFrom =
        existing.bearingCurrent;

      existing.bearingTarget =
        existing.bearingFrom +
        shortestAngleDelta(
          existing.bearingFrom,
          targetBearing,
        );
    }

    for (
      const id
      of this.states.keys()
    ) {
      if (!seen.has(id)) {
        this.states.delete(id);
      }
    }
  }
}