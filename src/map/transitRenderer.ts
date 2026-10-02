import type { Map as TransitMap, GeoJSONSource } from "maplibre-gl";
import type { Shape, Vehicle, TransitMode } from "../transit/networkTypes";
import { progressAt, correctionOffset } from "../transit/motion";
import { GpsPlayback } from '../transit/gpsPlayback';
import { composition, vehiclePose } from '../transit/vehiclePose';
import { estimatedBusDwell } from '../transit/stopMotion';
import type { VehicleModels, ModelItem } from './vehicleModels';

type State = { vehicle: Vehicle; offset: number; startedAt: number; duration: number; playback?: GpsPlayback };
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
  disabledLayers = new Set<string>();
  showUnderground = true;
  private models?: VehicleModels;
  private modelsLoading = false;
  renderMilliseconds = 0;
  renderedVehicles = 0;
  onSelectedPosition?: (coordinate: [number, number]) => void;
  constructor(private readonly map: TransitMap) {}
  private progress(state: State, now: number) {
    if (state.playback) return state.playback.position(now) ?? state.vehicle.progressMetersAlongShape;
    return (progressAt(state.vehicle.timeline, now, true) ?? state.vehicle.progressMetersAlongShape) + correctionOffset(state.offset, state.startedAt, state.duration, now);
  }
  update(vehicles: Vehicle[], fetchedAt: number, serverTime = Date.now()) {
    this.clockOffset = serverTime - Date.now(); this.snapshotAt = fetchedAt;
    const now = Date.now() + this.clockOffset;
    const next = new Map<string, State>();
    for (const vehicle of vehicles) {
      if (vehicle.mode === 'bus' && vehicle.observationTimestamp === null) vehicle.timeline = estimatedBusDwell(vehicle.timeline);
      const previous = this.states.get(vehicle.id);
      if (vehicle.observationTimestamp !== null) {
        const playback = previous?.vehicle.shapeKey === vehicle.shapeKey ? previous.playback ?? new GpsPlayback() : new GpsPlayback();
        playback.append({ at: vehicle.observationTimestamp, progress: vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape }, vehicle.previousObservation);
        // Hidden operators/modes still advance their source clock on every snapshot.
        playback.position(now);
        next.set(vehicle.id, { vehicle, offset: 0, startedAt: now, duration: 0, playback });
        continue;
      }
      const target = progressAt(vehicle.timeline, now, true) ?? vehicle.progressMetersAlongShape;
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
    return shape ? vehiclePose(shape, this.progress(state, Date.now() + this.clockOffset), state.vehicle)?.coordinate ?? null : [state.vehicle.longitude, state.vehicle.latitude] as [number, number];
  }
  getVehicles() {
    return [...this.states.values()].map((s) => s.vehicle).filter((v) => this.operators.has(v.operatorId) && !this.disabledLayers.has(`${v.operatorId}:${v.mode}`) && (this.mode === "all" || v.mode === this.mode));
  }
  start() {
    const tick = (frame: number) => {
      if (frame - this.lastFrame >= (window.innerWidth < 700 ? 85 : 65)) { this.lastFrame = frame; this.render(); }
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  stop() { cancelAnimationFrame(this.animation); }
  dataQuality(id: string) { const state = this.states.get(id); return !state?.vehicle.observationTimestamp ? 'estimated' as const : state.playback?.interpolated ? 'interpolated' as const : 'real' as const; }
  renderedTimestamp(id: string) { return this.states.get(id)?.playback?.renderedAt ?? Date.now() + this.clockOffset; }
  private render() {
    const started = performance.now();
    const source = this.map.getSource("vehicles") as GeoJSONSource | undefined;
    if (!source || !this.map.isStyleLoaded()) return;
    const now = Date.now() + this.clockOffset;
    const features = []; const selected = []; const models: ModelItem[] = [];
    const bounds = this.map.getBounds(); const zoom = this.map.getZoom(); const close = zoom >= 15;
    if (close && !this.map.getLayer('transit-models') && !this.modelsLoading) {
      this.modelsLoading = true;
      void import('./vehicleModels').then(({ VehicleModels }) => {
        if (this.map.isStyleLoaded() && !this.map.getLayer('transit-models')) { this.models = new VehicleModels(); this.map.addLayer(this.models, 'selected-halo'); }
      }).finally(() => { this.modelsLoading = false; });
    }
    if (now - this.snapshotAt > 180_000) {
      for (const id of ["vehicles", "selected-vehicle", "vehicle-bodies"]) (this.map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      this.models?.update([]);
      return;
    }
    for (const vehicle of this.getVehicles()) {
      if (vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp && now - vehicle.observationTimestamp > 180_000) continue;
      const state = this.states.get(vehicle.id)!;
      const shape = this.shapes.get(vehicle.shapeKey);
      const progress = this.progress(state, now);
      const position = shape ? vehiclePose(shape, progress, vehicle) : null;
      const coordinate = position?.coordinate ?? [vehicle.longitude, vehicle.latitude] as [number, number];
      if (!bounds.contains(coordinate) && this.selectedId !== vehicle.id) continue;
      const focused = !this.focusRoute || (vehicle.routeKey === this.focusRoute && (this.direction === "all" || String(vehicle.directionId ?? "unknown") === this.direction));
      const bearing = position?.bearing ?? vehicle.bearing;
      const underground = position?.underground ?? false;
      if (underground && !this.showUnderground) continue;
      const properties = { id: vehicle.id, label: vehicle.label, destination: vehicle.headsign.length > 27 ? vehicle.headsign.slice(0, 26) + '…' : vehicle.headsign, mode: vehicle.mode, color: vehicle.color, bearing, quality: this.dataQuality(vehicle.id), underground, focused, selected: this.selectedId === vehicle.id };
      features.push({ type: "Feature" as const, properties, geometry: { type: "Point" as const, coordinates: coordinate } });
      if (this.selectedId === vehicle.id) { selected.push(features.at(-1)!); this.onSelectedPosition?.(coordinate); }
      if (close && shape && models.length < 780 && bounds.contains(coordinate)) {
        const consist = composition(vehicle);
        for (let car = 0; car < consist.count; car++) {
          const at = progress - car * (consist.length + consist.gap);
          if (at < 0) continue;
          const pose = vehiclePose(shape, at, vehicle); if (!pose) continue;
          models.push({ ...pose, color: vehicle.color, length: consist.length, bus: vehicle.mode === 'bus', scale: vehicle.mode === 'bus' ? Math.min(2.4, Math.max(1, 2 ** (16.3 - zoom))) : 1 });
        }
      }
    }
    source.setData({ type: "FeatureCollection", features });
    (this.map.getSource("selected-vehicle") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: selected });
    this.models?.update(models); if (close) this.map.triggerRepaint();
    this.renderedVehicles = features.length; this.renderMilliseconds = performance.now() - started;
  }
}
