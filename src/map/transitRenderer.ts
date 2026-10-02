import type { Map as TransitMap, GeoJSONSource } from "maplibre-gl";
import type { Shape, Vehicle, TransitMode } from "../transit/networkTypes";
import { progressAt } from "../transit/motion";
import { advanceProgress, motionLimits } from '../transit/progressFollower';
import { GpsMotion } from '../transit/gpsMotion';
import { composition, vehiclePose } from '../transit/vehiclePose';
import { estimatedBusDwell } from '../transit/stopMotion';
import type { VehicleModels, ModelItem } from './vehicleModels';
import { MODEL_MIN_ZOOM, MODEL_CAPACITY, modelLevel, representation, vehicleKind, vehicleScale } from './vehicleLod';
import { renderedPositionSource } from '../../shared/transit/freshness';

type State = { vehicle: Vehicle; progress: number; speed: number; at: number; motion?: GpsMotion };
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
  private modelsFailed = false;
  lod = 'cluster';
  modelFallbackReason = 'low-zoom';
  modelCars = 0;
  modelVehicles = 0;
  renderMilliseconds = 0;
  renderedVehicles = 0;
  onSelectedPosition?: (coordinate: [number, number]) => void;
  constructor(private readonly map: TransitMap, private readonly loadModels: () => Promise<VehicleModels> = async () => {
    const { VehicleModels } = await import('./vehicleModels');
    return new VehicleModels();
  }) {}
  private progress(state: State, now: number) {
    if (state.motion) return state.motion.position(now) ?? state.vehicle.progressMetersAlongShape;
    const dt = Math.max(0, (now - state.at) / 1000);
    if (!dt) return state.progress;
    const rail = state.vehicle.mode === 'rail' || state.vehicle.mode === 'tram';
    const target = progressAt(state.vehicle.timeline, now, rail) ?? state.vehicle.progressMetersAlongShape;
    const limits = motionLimits(state.vehicle.mode, state.vehicle.maximumSpeedMetersPerSecond);
    const pace = Math.max(0, Math.min(limits.speed, ((progressAt(state.vehicle.timeline, now + 250, rail) ?? target) - target) * 4));
    const next = advanceProgress(state.progress, state.speed, dt, target, pace, 30, limits.speed, limits.acceleration, this.shapes.get(state.vehicle.shapeKey)?.total);
    state.progress = next.progress; state.speed = next.speed; state.at = now;
    return state.progress;
  }
  update(vehicles: Vehicle[], fetchedAt: number, serverTime = Date.now()) {
    this.clockOffset = serverTime - Date.now(); this.snapshotAt = fetchedAt;
    const now = Date.now() + this.clockOffset;
    const next = new Map<string, State>();
    for (const vehicle of vehicles) {
      if (vehicle.mode === 'bus' && vehicle.observationTimestamp === null) vehicle.timeline = estimatedBusDwell(vehicle.timeline);
      const previous = this.states.get(vehicle.id);
      const compatible = previous?.vehicle.shapeKey === vehicle.shapeKey ? previous : undefined;
      const displayed = compatible ? this.progress(compatible, now) : undefined;
      const speed = compatible?.motion?.diagnostics.renderedSpeed ?? compatible?.speed ?? 0;
      if (vehicle.observationTimestamp !== null) {
        const motion = compatible?.motion ?? new GpsMotion(displayed === undefined ? undefined : { progress: displayed, speed });
        motion.setEnd(this.shapes.get(vehicle.shapeKey)?.total ?? Infinity);
        motion.update({ at: vehicle.observationTimestamp, progress: vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape }, now, { mode: vehicle.mode, timeline: vehicle.timeline, previous: vehicle.previousObservation, speed: vehicle.speedMetersPerSecond, stopped: vehicle.stoppedAtStop, maximumSpeed: vehicle.maximumSpeedMetersPerSecond, realtimeTimetable: vehicle.timetableTimestamp != null, forecastTimestamp: vehicle.timetableTimestamp });
        next.set(vehicle.id, { vehicle, progress: displayed ?? vehicle.progressMetersAlongShape, speed, at: now, motion });
        if (vehicle.id === this.selectedId && previous?.vehicle.observationTimestamp !== vehicle.observationTimestamp && new URLSearchParams(location.search).has('debug')) console.debug('[transit-motion]', { id: vehicle.id, fetchedAt, ...motion.diagnostics });
        continue;
      }
      const target = progressAt(vehicle.timeline, now, vehicle.mode === 'rail' || vehicle.mode === 'tram') ?? vehicle.progressMetersAlongShape;
      next.set(vehicle.id, { vehicle, progress: displayed ?? target, speed, at: now });
    }
    this.states = next;
  }
  coordinate(id: string) {
    const state = this.states.get(id); if (!state) return null;
    const shape = this.shapes.get(state.vehicle.shapeKey);
    const width = this.map.getZoom() >= MODEL_MIN_ZOOM ? vehicleScale(state.vehicle, this.map.getZoom(), state.vehicle.latitude).width : 1;
    return shape ? vehiclePose(shape, this.progress(state, Date.now() + this.clockOffset), state.vehicle, width)?.coordinate ?? null : [state.vehicle.longitude, state.vehicle.latitude] as [number, number];
  }
  getVehicles() {
    return [...this.states.values()].map((s) => s.vehicle).filter((v) => this.operators.has(v.operatorId) && !this.disabledLayers.has(`${v.operatorId}:${v.mode}`) && (this.mode === "all" || v.mode === this.mode));
  }
  start() {
    if (this.animation) return;
    const tick = (frame: number) => {
      if (frame - this.lastFrame >= (window.innerWidth < 700 ? 85 : 65)) { this.lastFrame = frame; this.render(); }
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  stop() { cancelAnimationFrame(this.animation); this.animation = 0; }
  dataQuality(id: string) { return this.states.get(id)?.motion?.quality ?? 'estimated' as const; }
  positionSource(id: string) { const state = this.states.get(id); return state ? renderedPositionSource(state.vehicle, this.dataQuality(id), Date.now() + this.clockOffset) : null; }
  renderedTimestamp(id: string) { return this.states.get(id)?.motion?.diagnostics.motionTimestamp ?? Date.now() + this.clockOffset; }
  diagnostics(id: string) { return this.states.get(id)?.motion?.diagnostics ?? null; }
  private render() {
    const started = performance.now();
    const source = this.map.getSource("vehicles") as GeoJSONSource | undefined;
    if (!source || !this.map.isStyleLoaded()) return;
    const now = Date.now() + this.clockOffset;
    const features = []; const selected = []; const models: ModelItem[] = [];
    const bounds = this.map.getBounds(); const zoom = this.map.getZoom();
    if (zoom >= MODEL_MIN_ZOOM && !this.map.getLayer('transit-models') && !this.modelsLoading && !this.modelsFailed) {
      this.modelsLoading = true;
      void this.loadModels().then((models) => {
        // GeoJSON setData marks isStyleLoaded() false while workers process it.
        // The anchor layer proves the style can accept a custom layer even then.
        // Requiring idle sources here can prevent cached imports from ever mounting.
        if (this.animation && this.map.getLayer('selected-halo') && !this.map.getLayer('transit-models')) { this.models = models; this.map.addLayer(models, 'selected-halo'); }
      }).catch((error) => { this.modelsFailed = true; console.warn('[transit-models] Model loading failed; using mode silhouettes.', error); }).finally(() => { this.modelsLoading = false; });
    }
    const vehicles = this.getVehicles();
    const modelsReady = !!this.models?.ready && !!this.map.getLayer('transit-models');
    const prepareModels = zoom >= MODEL_MIN_ZOOM && modelsReady;
    if (now - this.snapshotAt > 180_000) {
      for (const id of ["vehicles", "selected-vehicle", "vehicle-bodies"]) (this.map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      this.models?.update([], false); this.modelCars = 0; this.modelVehicles = 0;
      return;
    }
    let modelVehicles = 0;
    for (const vehicle of vehicles) {
      if (vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp && now - vehicle.observationTimestamp > 180_000) continue;
      const state = this.states.get(vehicle.id)!;
      const shape = this.shapes.get(vehicle.shapeKey);
      if (shape) state.motion?.setEnd(shape.total);
      const progress = this.progress(state, now);
      const scale = vehicleScale(vehicle, zoom, vehicle.latitude);
      const position = shape ? vehiclePose(shape, progress, vehicle, zoom >= MODEL_MIN_ZOOM ? scale.width : 1) : null;
      const coordinate = position?.coordinate ?? [vehicle.longitude, vehicle.latitude] as [number, number];
      if (!bounds.contains(coordinate) && this.selectedId !== vehicle.id) continue;
      const focused = !this.focusRoute || (vehicle.routeKey === this.focusRoute && (this.direction === "all" || String(vehicle.directionId ?? "unknown") === this.direction));
      const bearing = position?.bearing ?? vehicle.bearing;
      const underground = position?.underground ?? false;
      if (underground && !this.showUnderground) continue;
      const properties = { id: vehicle.id, label: vehicle.label, destination: vehicle.headsign.length > 27 ? vehicle.headsign.slice(0, 26) + '…' : vehicle.headsign, mode: vehicle.mode, kind: vehicleKind(vehicle), color: vehicle.color, bearing, quality: this.dataQuality(vehicle.id), underground, focused, selected: this.selectedId === vehicle.id };
      features.push({ type: "Feature" as const, properties, geometry: { type: "Point" as const, coordinates: coordinate } });
      if (this.selectedId === vehicle.id) { selected.push(features.at(-1)!); this.onSelectedPosition?.(coordinate); }
      if (prepareModels && bounds.contains(coordinate)) {
        modelVehicles++;
        const consist = composition(vehicle);
        for (let car = 0; car < consist.count; car++) {
          const at = progress - car * (consist.length + consist.gap) * scale.length;
          if (at < 0) continue;
          const pose = shape ? vehiclePose(shape, at, vehicle, scale.width) : car === 0 ? { coordinate, bearing, altitude: 0, underground: false } : null;
          if (!pose) continue;
          models.push({ ...pose, color: vehicle.color, length: consist.length, kind: vehicleKind(vehicle), scale, selected: vehicle.id === this.selectedId });
        }
      }
    }
    // Apply the GPU budget to actual visible cars, after stale/hidden/offscreen
    // filtering and shape-end handling. Regional traffic must not disable close 3D.
    const useModels = representation(zoom, modelsReady, models.length) === 'model';
    this.modelFallbackReason = useModels ? 'none' : zoom < MODEL_MIN_ZOOM ? 'low-zoom' : this.modelsFailed ? 'load-error' : !modelsReady ? 'loading' : models.length > MODEL_CAPACITY ? 'visible-capacity' : 'unknown';
    const visibility = useModels ? 'none' : 'visible';
    // Hide symbols synchronously before enabling models. GeoJSON worker latency
    // cannot leave old icons over the 3D bodies during the switch.
    if (this.map.getLayoutProperty('vehicle-icon', 'visibility') !== visibility) this.map.setLayoutProperty('vehicle-icon', 'visibility', visibility);
    this.lod = useModels ? modelLevel(zoom) : zoom < MODEL_MIN_ZOOM ? 'cluster / silhouette' : 'silhouette fallback';
    source.setData({ type: "FeatureCollection", features });
    (this.map.getSource("selected-vehicle") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: selected });
    this.models?.update(useModels ? models : [], useModels); if (useModels) this.map.triggerRepaint();
    this.modelCars = useModels ? models.length : 0; this.modelVehicles = useModels ? modelVehicles : 0;
    this.renderedVehicles = features.length; this.renderMilliseconds = performance.now() - started;
  }
}
