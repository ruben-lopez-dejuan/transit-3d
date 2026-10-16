import type { Map as TransitMap, GeoJSONSource } from "maplibre-gl";
import type { Shape, Vehicle, TransitMode } from "../transit/networkTypes";
import { GpsMotion } from '../transit/gpsMotion';
import { TimelineMotion } from '../transit/timelineMotion';
import { composition, vehiclePose, trackDepth, COVER_METERS } from '../transit/vehiclePose';
import { estimatedBusDwell } from '../transit/stopMotion';
import type { VehicleModels, ModelItem } from './vehicleModels';
import { MODEL_MIN_ZOOM, MODEL_CAPACITY, modelLevel, representation, vehicleKind, vehicleScale } from './vehicleLod';
import { renderedPositionSource, REALTIME_MAX_AGE_MS } from '../../shared/transit/freshness';
import { bodyFor, liveryFor } from '../../shared/transit/appearance';
import { carRole } from './vehicleShapes';
import { vehicleIconId, vehicleIconPixels } from './networkMap';

type State = { vehicle: Vehicle; progress: number; speed: number; at: number; motion?: GpsMotion; scheduled?: TimelineMotion };
/** Keep normal mobile motion fluid, but protect slower phones with very large fleets. */
export function renderInterval(viewportWidth: number, fleetSize: number, focused: boolean, reducedMotion: boolean) {
  if (reducedMotion) return 250;
  if (viewportWidth < 700 && fleetSize > 300 && !focused) return 80;
  return 48;
}
function distanceToPolyline(point: { x: number; y: number }, line: { x: number; y: number }[]) {
  if (line.length === 1) return Math.hypot(point.x - line[0].x, point.y - line[0].y);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}
/** Whether the last car of a train is in the tunnel too, so nothing of it is left above ground. */
function trainBuried(shape: Shape, progress: number, cars: number, spacing: number) {
  return trackDepth(shape, Math.max(0, progress - (cars - 1) * spacing)).depth >= COVER_METERS;
}
export class TransitRenderer {
  private states = new Map<string, State>();
  readonly shapes = new Map<string, Shape>();
  private animation = 0;
  private lastFrame = 0;
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    if (!state.scheduled) return state.progress;
    state.progress = state.scheduled.position(now, this.shapes.get(state.vehicle.shapeKey)?.total);
    state.speed = state.scheduled.speed; state.at = now;
    return state.progress;
  }
  update(vehicles: Vehicle[], fetchedAt: number, serverTime = Date.now()) {
    this.clockOffset = serverTime - Date.now(); this.snapshotAt = fetchedAt;
    const now = Date.now() + this.clockOffset;
    const next = new Map<string, State>();
    for (const vehicle of vehicles) {
      // An observed average pace already includes the time at stops; adding dwell would count it twice.
      if (vehicle.mode === 'bus' && (vehicle.observationTimestamp === null || (vehicle.gpsAnchoredTimeline && vehicle.speedMetersPerSecond == null))) vehicle.timeline = estimatedBusDwell(vehicle.timeline);
      const previous = this.states.get(vehicle.id);
      const compatible = previous?.vehicle.shapeKey === vehicle.shapeKey ? previous : undefined;
      const displayed = compatible ? this.progress(compatible, now) : undefined;
      const speed = compatible?.motion?.diagnostics.renderedSpeed ?? compatible?.speed ?? 0;
      if (vehicle.observationTimestamp !== null) {
        // A bus with GPS moves at its own observed pace. Official stop forecasts in whole minutes
        // (Bizkaibus) were too noisy to drive it between fixes: following them put it a median
        // 335 m and at worst over 1.2 km away, against ~175 m at its pace (audit 15 Oct 2026).
        // They still give the arrival times shown.
        const paceDriven = vehicle.mode === 'bus' && vehicle.speedMetersPerSecond != null;
        const motion = compatible?.motion ?? new GpsMotion(displayed === undefined ? undefined : { progress: displayed, speed });
        motion.setEnd(this.shapes.get(vehicle.shapeKey)?.total ?? Infinity);
        motion.setGate(vehicle.officialNextStop);
        motion.update({ at: vehicle.observationTimestamp, progress: vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape }, now, { mode: vehicle.mode, timeline: vehicle.timeline, previous: vehicle.previousObservation, speed: vehicle.speedMetersPerSecond, stopped: vehicle.stoppedAtStop, maximumSpeed: vehicle.maximumSpeedMetersPerSecond, realtimeTimetable: !paceDriven && vehicle.timetableTimestamp != null, anchoredTimeline: !!vehicle.gpsAnchoredTimeline, forecastTimestamp: paceDriven ? null : vehicle.timetableTimestamp });
        next.set(vehicle.id, { vehicle, progress: displayed ?? vehicle.progressMetersAlongShape, speed, at: now, motion });
        if (vehicle.id === this.selectedId && previous?.vehicle.observationTimestamp !== vehicle.observationTimestamp && new URLSearchParams(location.search).has('debug')) console.debug('[transit-motion]', { id: vehicle.id, fetchedAt, ...motion.diagnostics });
        continue;
      }
      const scheduled = new TimelineMotion(vehicle.mode === 'rail' || vehicle.mode === 'tram', vehicle.progressMetersAlongShape);
      scheduled.retime(vehicle.timeline, now, displayed, compatible?.scheduled);
      next.set(vehicle.id, { vehicle, progress: scheduled.position(now), speed, at: now, scheduled });
    }
    this.states = next;
  }
  progressMeters(id: string) {
    const state = this.states.get(id);
    return state ? this.progress(state, Date.now() + this.clockOffset) : null;
  }
  coordinate(id: string) {
    const state = this.states.get(id); if (!state) return null;
    const shape = this.shapes.get(state.vehicle.shapeKey);
    const width = this.map.getZoom() >= MODEL_MIN_ZOOM ? vehicleScale(state.vehicle, this.map.getZoom(), state.vehicle.latitude).width : 1;
    return shape ? vehiclePose(shape, this.progress(state, Date.now() + this.clockOffset), state.vehicle, width)?.coordinate ?? null : [state.vehicle.longitude, state.vehicle.latitude] as [number, number];
  }
  /**
   * The vehicle drawn under a screen point. The whole body counts, not only its front:
   * the icon is centred on the vehicle's position and the 3D cars trail behind it, and a
   * four-car train is far longer than the old 12 px circle at its head.
   */
  vehicleAt(point: { x: number; y: number }, tolerance: number): string | null {
    const now = Date.now() + this.clockOffset, zoom = this.map.getZoom();
    let best: { id: string; distance: number } | null = null;
    for (const vehicle of this.getVehicles()) {
      if (vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp && now - vehicle.observationTimestamp > REALTIME_MAX_AGE_MS) continue;
      const state = this.states.get(vehicle.id), shape = this.shapes.get(vehicle.shapeKey);
      if (!state) continue;
      const progress = this.progress(state, now), scale = vehicleScale(vehicle, zoom, vehicle.latitude);
      const head = shape ? vehiclePose(shape, progress, vehicle, zoom >= MODEL_MIN_ZOOM ? scale.width : 1) : null;
      const consist = composition(vehicle), icon = vehicleIconPixels(vehicle, zoom);
      if (!this.showUnderground && shape && head?.buried === 1 && trainBuried(shape, progress, consist.count, (consist.length + consist.gap) * scale.length)) continue;
      const headPoint = this.map.project(head?.coordinate ?? [vehicle.longitude, vehicle.latitude]);
      const metersPerPixel = 40075016.686 * Math.cos(vehicle.latitude * Math.PI / 180) / (512 * 2 ** zoom);
      const modelMeters = (consist.count * consist.length + (consist.count - 1) * consist.gap) * scale.length;
      const ahead = icon.length / 2 * metersPerPixel, behind = Math.max(modelMeters, ahead);
      const reach = (ahead + behind) / metersPerPixel + tolerance + icon.width;
      if (Math.hypot(headPoint.x - point.x, headPoint.y - point.y) > reach) continue;
      // Sample the body along the track, from just ahead of the position to the last car.
      const samples = shape ? Math.max(2, Math.ceil((ahead + behind) / metersPerPixel / 8)) : 0;
      const line = shape ? Array.from({ length: samples + 1 }, (_, i) => vehiclePose(shape, progress + ahead - (ahead + behind) * i / samples, vehicle, 1)?.coordinate).filter((c): c is [number, number] => !!c).map((c) => this.map.project(c)) : [headPoint];
      const distance = distanceToPolyline(point, line) - Math.max(icon.width, scale.width * 2.7 / metersPerPixel) / 2;
      if (distance <= tolerance && (!best || distance < best.distance)) best = { id: vehicle.id, distance };
    }
    return best?.id ?? null;
  }
  getVehicles() {
    return [...this.states.values()].map((s) => s.vehicle).filter((v) => this.operators.has(v.operatorId) && !this.disabledLayers.has(`${v.operatorId}:${v.mode}`) && (this.mode === "all" || v.mode === this.mode));
  }
  start() {
    if (this.animation) return;
    const tick = (frame: number) => {
      if (frame - this.lastFrame >= renderInterval(window.innerWidth, this.states.size, !!this.focusRoute, this.reducedMotion)) { this.lastFrame = frame; this.render(); }
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
    const vehicles = this.getVehicles().filter((vehicle) => !this.focusRoute || (vehicle.routeKey === this.focusRoute && (this.direction === "all" || String(vehicle.directionId ?? "unknown") === this.direction)));
    const modelsReady = !!this.models?.ready && !!this.map.getLayer('transit-models');
    const prepareModels = zoom >= MODEL_MIN_ZOOM && modelsReady;
    if (now - this.snapshotAt > REALTIME_MAX_AGE_MS) {
      for (const id of ["vehicles", "selected-vehicle", "vehicle-bodies"]) (this.map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      this.models?.update([], false); this.modelCars = 0; this.modelVehicles = 0;
      return;
    }
    let modelVehicles = 0;
    for (const vehicle of vehicles) {
      if (vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp && now - vehicle.observationTimestamp > REALTIME_MAX_AGE_MS) continue;
      const state = this.states.get(vehicle.id)!;
      const shape = this.shapes.get(vehicle.shapeKey);
      if (shape) state.motion?.setEnd(shape.total);
      const progress = this.progress(state, now);
      const scale = vehicleScale(vehicle, zoom, vehicle.latitude);
      const position = shape ? vehiclePose(shape, progress, vehicle, zoom >= MODEL_MIN_ZOOM ? scale.width : 1) : null;
      const coordinate = position?.coordinate ?? [vehicle.longitude, vehicle.latitude] as [number, number];
      if (!bounds.contains(coordinate) && this.selectedId !== vehicle.id) continue;
      const bearing = position?.bearing ?? vehicle.bearing;
      const underground = position?.underground ?? false;
      const consist = composition(vehicle), carSpacing = (consist.length + consist.gap) * scale.length;
      // Without underground trains, one entering a tunnel goes on showing until its last car is in.
      if (!this.showUnderground && shape && position?.buried === 1 && trainBuried(shape, progress, consist.count, carSpacing)) continue;
      const livery = liveryFor(vehicle);
      const properties = { id: vehicle.id, label: vehicle.label, destination: vehicle.headsign.length > 27 ? vehicle.headsign.slice(0, 26) + '…' : vehicle.headsign, mode: vehicle.mode, kind: vehicleKind(vehicle), color: livery.body, icon: vehicleIconId(vehicle), bearing, quality: this.dataQuality(vehicle.id), underground, buried: position?.buried ?? 0, focused: true, selected: this.selectedId === vehicle.id };
      features.push({ type: "Feature" as const, properties, geometry: { type: "Point" as const, coordinates: coordinate } });
      if (this.selectedId === vehicle.id) { selected.push(features.at(-1)!); this.onSelectedPosition?.(coordinate); }
      if (prepareModels && bounds.contains(coordinate)) {
        modelVehicles++;
        for (let car = 0; car < consist.count; car++) {
          const at = progress - car * carSpacing;
          if (at < 0) continue;
          const pose = shape ? vehiclePose(shape, at, vehicle, scale.width) : car === 0 ? { coordinate, bearing, altitude: 0, slope: 0, buried: 0 } : null;
          if (!pose || (pose.buried === 1 && !this.showUnderground)) continue;
          // Depth is exaggerated like the car's height, so a car sinks by the same share of itself at every zoom.
          models.push({ coordinate: pose.coordinate, bearing: pose.bearing, altitude: pose.altitude * scale.height, pitch: -Math.atan(Math.max(-.35, Math.min(.35, pose.slope * scale.height))), buried: pose.buried, color: livery.body, accent: livery.accent, front: livery.front ?? livery.body, band: livery.band ?? 'thin', length: consist.length, gap: consist.gap, kind: vehicleKind(vehicle), body: bodyFor(vehicle), role: carRole(car, consist.count), scale, selected: vehicle.id === this.selectedId });
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
    this.models?.update(useModels ? models : [], useModels, this.showUnderground); if (useModels) this.map.triggerRepaint();
    this.modelCars = useModels ? models.length : 0; this.modelVehicles = useModels ? modelVehicles : 0;
    this.renderedVehicles = features.length; this.renderMilliseconds = performance.now() - started;
  }
}
