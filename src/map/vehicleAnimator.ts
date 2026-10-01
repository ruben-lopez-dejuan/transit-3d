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

function shortestAngleDelta(
  from: number,
  to: number,
) {
  return ((to - from + 540) % 360) - 180;
}

export class VehicleAnimator {
  private states = new Map<string, VehicleState>();
  private latestVehicles = new Map<string, LiveVehicle>();
  private animationFrame: number | null = null;

  constructor(
    private readonly source: GeoJSONSource,
  ) {}

  start() {
    if (this.animationFrame !== null) return;

    const animate = () => {
      const now = performance.now();
      const features = [];

      for (const [id, state] of this.states) {
        const rawProgress = Math.min(
          1,
          Math.max(
            0,
            (now - state.startedAt) /
              state.duration,
          ),
        );

        const progress =
          1 -
          Math.pow(1 - rawProgress, 3);

        state.current = [
          state.from[0] +
            (state.target[0] - state.from[0]) *
              progress,
          state.from[1] +
            (state.target[1] - state.from[1]) *
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
          this.latestVehicles.get(id);

        if (!vehicle) continue;

        features.push({
          type: "Feature" as const,
          id,
          properties: {
            vehicleId:
              vehicle.vehicleId ?? "",
            routeShortName:
              vehicle.routeShortName,
            headsign: vehicle.headsign,
            stopName:
              vehicle.stopName ?? "",
            timestamp:
              vehicle.timestamp ?? 0,
            bearing:
              (
                (
                  state.bearingCurrent %
                  360
                ) +
                360
              ) %
              360,
            distanceToShapeMeters:
              vehicle.distanceToShapeMeters,
          },
          geometry: {
            type: "Point" as const,
            coordinates: state.current,
          },
        });
      }

      this.source.setData({
        type: "FeatureCollection",
        features,
      });

      this.animationFrame =
        requestAnimationFrame(animate);
    };

    this.animationFrame =
      requestAnimationFrame(animate);
  }

  stop() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(
        this.animationFrame,
      );

      this.animationFrame = null;
    }
  }

  clear() {
    this.states.clear();
    this.latestVehicles.clear();

    this.source.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  update(vehicles: LiveVehicle[]) {
    const now = performance.now();
    const seen = new Set<string>();

    this.latestVehicles = new Map(
      vehicles.map((vehicle) => [
        vehicle.vehicleId ||
          vehicle.entityId,
        vehicle,
      ]),
    );

    for (const vehicle of vehicles) {
      const id =
        vehicle.vehicleId ||
        vehicle.entityId;

      seen.add(id);

      const target: [number, number] = [
        vehicle.longitude,
        vehicle.latitude,
      ];

      const targetBearing =
        vehicle.bearing || 0;

      const existing =
        this.states.get(id);

      if (!existing) {
        this.states.set(id, {
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
        });

        continue;
      }

      existing.from = [
        ...existing.current,
      ];

      existing.target = target;
      existing.startedAt = now;
      existing.duration = 4_300;

      existing.bearingFrom =
        existing.bearingCurrent;

      existing.bearingTarget =
        existing.bearingFrom +
        shortestAngleDelta(
          existing.bearingFrom,
          targetBearing,
        );
    }

    for (const id of this.states.keys()) {
      if (!seen.has(id)) {
        this.states.delete(id);
      }
    }
  }
}
