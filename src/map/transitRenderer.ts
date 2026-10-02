import type { Map as TransitMap, GeoJSONSource } from "maplibre-gl";
import type { Shape, Vehicle, TransitMode } from "../transit/networkTypes";
import { progressAt, positionAlong, correctionOffset, positionQuality } from "../transit/motion";

type State = { vehicle: Vehicle; offset: number; startedAt: number; duration: number };
export class TransitRenderer {
  private states = new Map<string, State>();
  readonly shapes = new Map<string, Shape>();
  private animation = 0;
  private lastFrame = 0;
  private snapshotAt = 0;
  clockOffset = 0;
  mode: TransitMode | "all" = "all";
  operators = new Set<string>();
  focusRoute: string | null = null;
  direction = "all";
  selectedId: string | null = null;
  onSelectedPosition?: (coordinate: [number, number]) => void;
  constructor(private readonly map: TransitMap) {}
  private progress(state: State, now: number) {
    return (progressAt(state.vehicle.timeline, now, state.vehicle.mode !== "bus") ?? state.vehicle.progressMetersAlongShape) + correctionOffset(state.offset, state.startedAt, state.duration, now);
  }
  update(vehicles: Vehicle[], fetchedAt: number) {
    this.clockOffset = fetchedAt - Date.now(); this.snapshotAt = fetchedAt;
    const now = Date.now() + this.clockOffset;
    const next = new Map<string, State>();
    for (const vehicle of vehicles) {
      const previous = this.states.get(vehicle.id);
      const target = progressAt(vehicle.timeline, now, vehicle.mode !== "bus") ?? vehicle.progressMetersAlongShape;
      if (previous && previous.vehicle.shapeKey === vehicle.shapeKey) {
        const offset = this.progress(previous, now) - target;
        next.set(vehicle.id, { vehicle, offset, startedAt: now, duration: Math.max(5000, Math.min(20_000, 5000 + Math.abs(offset) * 20)) });
      } else next.set(vehicle.id, { vehicle, offset: 0, startedAt: now, duration: 5000 });
    }
    this.states = next;
  }
  coordinate(id: string) {
    const state = this.states.get(id); if (!state) return null;
    const shape = this.shapes.get(state.vehicle.shapeKey);
    return shape ? positionAlong(shape, this.progress(state, Date.now() + this.clockOffset))?.coordinate ?? null : [state.vehicle.longitude, state.vehicle.latitude] as [number, number];
  }
  getVehicles() {
    return [...this.states.values()].map((s) => s.vehicle).filter((v) => this.operators.has(v.operatorId) && (this.mode === "all" || v.mode === this.mode));
  }
  start() {
    const tick = (frame: number) => {
      if (frame - this.lastFrame >= (window.innerWidth < 700 ? 85 : 65)) { this.lastFrame = frame; this.render(); }
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  stop() { cancelAnimationFrame(this.animation); }
  private render() {
    const source = this.map.getSource("vehicles") as GeoJSONSource | undefined;
    if (!source || !this.map.isStyleLoaded()) return;
    const now = Date.now() + this.clockOffset;
    const features = []; const bodies = []; const selected = [];
    const bounds = this.map.getBounds(); const close = this.map.getZoom() >= 17;
    if (now - this.snapshotAt > 180_000) {
      for (const id of ["vehicles", "selected-vehicle", "vehicle-bodies"]) (this.map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    for (const vehicle of this.getVehicles()) {
      if (vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp && now - vehicle.observationTimestamp > 180_000) continue;
      const state = this.states.get(vehicle.id)!;
      const shape = this.shapes.get(vehicle.shapeKey);
      const position = shape ? positionAlong(shape, this.progress(state, now)) : null;
      const coordinate = position?.coordinate ?? [vehicle.longitude, vehicle.latitude] as [number, number];
      const focused = !this.focusRoute || (vehicle.routeKey === this.focusRoute && (this.direction === "all" || String(vehicle.directionId ?? "unknown") === this.direction));
      const bearing = position?.bearing ?? vehicle.bearing;
      const properties = { id: vehicle.id, label: vehicle.label, mode: vehicle.mode, color: vehicle.color, bearing, quality: positionQuality(vehicle, now), focused, selected: this.selectedId === vehicle.id };
      features.push({ type: "Feature" as const, properties, geometry: { type: "Point" as const, coordinates: coordinate } });
      if (this.selectedId === vehicle.id) { selected.push(features.at(-1)!); this.onSelectedPosition?.(coordinate); }
      if (close && focused && bodies.length < 60 && bounds.contains(coordinate)) {
        const length = vehicle.mode === "bus" ? 12 : vehicle.mode === "tram" ? 30 : 45;
        const angle = bearing * Math.PI / 180;
        const polygon = [[length / 2, -1.3], [length / 2, 1.3], [-length / 2, 1.3], [-length / 2, -1.3], [length / 2, -1.3]].map(([forward, right]) => {
          const east = forward * Math.sin(angle) + right * Math.cos(angle), north = forward * Math.cos(angle) - right * Math.sin(angle);
          return [coordinate[0] + east / (111_320 * Math.cos(coordinate[1] * Math.PI / 180)), coordinate[1] + north / 110_540];
        });
        bodies.push({ type: "Feature" as const, properties, geometry: { type: "Polygon" as const, coordinates: [polygon] } });
      }
    }
    source.setData({ type: "FeatureCollection", features });
    (this.map.getSource("selected-vehicle") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: selected });
    (this.map.getSource("vehicle-bodies") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: bodies });
  }
}
