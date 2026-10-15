import { MercatorCoordinate, type Map as TransitMap, type CustomLayerInterface, type CustomRenderMethodInput } from 'maplibre-gl';
import * as THREE from 'three';
import { MODEL_CAPACITY, MODEL_MIN_ZOOM, type VehicleKind } from './vehicleLod';
import { TAIL, vehicleParts, type Tint } from './vehicleShapes';
import type { LiveryBand, VehicleBody } from '../../shared/transit/contracts';

export type ModelItem = {
  coordinate: [number, number]; bearing: number; color: string; accent: string; front: string; band: LiveryBand; length: number; gap: number;
  kind: VehicleKind; body: VehicleBody; role: number;
  /** altitude: metres below (negative) ground; pitch: radians, nose up; buried: share of the car below ground, 0–1. */
  altitude: number; pitch: number; buried: number; selected: boolean;
  scale: { width: number; length: number; height: number };
};
// Scene coordinates are metres with z up and ground level at z = 0.
const ABOVE_GROUND = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const BELOW_GROUND = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
type Pool = { mesh: THREE.InstancedMesh; capacity: number; minZoom: number; maxZoom: number; tinted?: Tint; on: number };

/** One body per car at every LOD. Extra parts appear, never a second vehicle body. */
export class VehicleModels implements CustomLayerInterface {
  readonly id = 'transit-models'; readonly type = 'custom' as const; readonly renderingMode = '3d' as const;
  ready = false; enabled = false;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene(); private camera = new THREE.Camera();
  private pools: Pool[] = []; private groups = new Map<string, Pool[]>(); private map!: TransitMap;
  private origin!: MercatorCoordinate; private units = 1; private local = new THREE.Matrix4();
  private transform = new THREE.Object3D(); private color = new THREE.Color(); private accent = new THREE.Color(); private front = new THREE.Color(); private white = new THREE.Color('#fff');

  onAdd(map: TransitMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map; this.origin = MercatorCoordinate.fromLngLat(map.getCenter()); this.units = this.origin.meterInMercatorCoordinateUnits();
    this.local.makeTranslation(this.origin.x, this.origin.y, 0).multiply(new THREE.Matrix4().makeScale(this.units, -this.units, this.units));
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext }); this.renderer.autoClear = false; this.renderer.localClippingEnabled = true;
    this.scene.add(new THREE.AmbientLight('#fff', 1.3));
    const light = new THREE.DirectionalLight('#fff', 1.8); light.position.set(-3, 4, 8); this.scene.add(light);
    this.ready = true;
  }

  /** Meshes for one fleet's shape and band, built the first time a vehicle needs them. A car seen through the ground keeps only its shell. */
  private group(item: ModelItem, ghost: boolean) {
    const { kind, band, body, length, gap } = item;
    const key = `${kind}:${band}:${body.cab}:${body.doors}:${body.width}:${body.height}:${length}:${gap}:${ghost}`;
    let group = this.groups.get(key);
    if (group) return group;
    group = [];
    for (const part of vehicleParts(kind, band, body, length, gap)) {
      if (ghost && !part.ghost) { part.geometry.dispose(); continue; }
      // A car going into a tunnel is cut at ground level: solid above, a ghost of itself below.
      const material = new THREE.MeshLambertMaterial({ color: part.color, transparent: ghost, opacity: ghost ? .38 : 1, depthTest: !ghost, depthWrite: !ghost, clippingPlanes: [ghost ? BELOW_GROUND : ABOVE_GROUND] });
      const capacity = kind === 'bus' ? 512 : kind === 'train' ? 256 : 128;
      const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const pool = { mesh, capacity, minZoom: part.minZoom, maxZoom: part.maxZoom ?? Infinity, tinted: part.tinted, on: part.on };
      this.scene.add(mesh); this.pools.push(pool); group.push(pool);
    }
    this.groups.set(key, group);
    return group;
  }

  private grow(pool: Pool) {
    const previous = pool.mesh;
    pool.capacity = Math.min(MODEL_CAPACITY, pool.capacity * 2);
    const mesh = new THREE.InstancedMesh(previous.geometry, previous.material, pool.capacity);
    mesh.count = previous.count; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    (mesh.instanceMatrix.array as Float32Array).set(previous.instanceMatrix.array.slice(0, previous.count * 16));
    if (previous.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3), 3);
      (mesh.instanceColor.array as Float32Array).set(previous.instanceColor.array.slice(0, previous.count * 3));
    }
    this.scene.remove(previous); previous.dispose(); this.scene.add(mesh); pool.mesh = mesh;
  }

  /** `ghosts`: whether to draw what is under ground (the «Ver Metro subterráneo» layer option). */
  update(items: ModelItem[], enabled = true, ghosts = true) {
    this.enabled = enabled;
    if (!this.ready) return;
    const zoom = this.map.getZoom();
    for (const pool of this.pools) pool.mesh.count = 0;
    // Mercator conversion and matrix happen once per car, once per preparation tick.
    for (const item of items) {
      const coordinate = MercatorCoordinate.fromLngLat(item.coordinate), ratio = coordinate.meterInMercatorCoordinateUnits() / this.units;
      this.transform.position.set((coordinate.x - this.origin.x) / this.units, -(coordinate.y - this.origin.y) / this.units, item.altitude * ratio);
      // The tail car is a lead car turned round, its cab facing back, so on a gradient it tilts the other way.
      this.transform.rotation.set(item.role & TAIL ? -item.pitch : item.pitch, 0, -item.bearing * Math.PI / 180 + (item.role & TAIL ? Math.PI : 0), 'ZXY');
      this.transform.scale.set(item.scale.width * ratio, item.scale.length * ratio, item.scale.height * ratio);
      this.transform.updateMatrix(); this.color.set(item.color); this.accent.set(item.accent); this.front.set(item.front); if (item.selected) this.color.lerp(this.white, .18);
      const pools = [...item.buried < 1 ? this.group(item, false) : [], ...item.buried > 0 && ghosts ? this.group(item, true) : []];
      for (const pool of pools) {
        if (!(pool.on & item.role) || zoom < pool.minZoom || zoom >= pool.maxZoom || pool.mesh.count >= MODEL_CAPACITY) continue;
        if (pool.mesh.count >= pool.capacity) this.grow(pool);
        const index = pool.mesh.count++;
        pool.mesh.setMatrixAt(index, this.transform.matrix);
        if (pool.tinted) pool.mesh.setColorAt(index, pool.tinted === 'accent' ? this.accent : pool.tinted === 'front' ? this.front : this.color);
      }
    }
    for (const { mesh } of this.pools) if (mesh.count) {
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16); mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, mesh.count * 3); mesh.instanceColor.needsUpdate = true; }
    }
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.enabled || this.map.getZoom() < MODEL_MIN_ZOOM) return;
    this.camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(this.local);
    for (const pool of this.pools) pool.mesh.visible = pool.mesh.count > 0 && this.map.getZoom() >= pool.minZoom && this.map.getZoom() < pool.maxZoom;
    this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.renderer.resetState();
  }

  onRemove() {
    this.ready = false; this.enabled = false;
    new Set(this.pools.map((pool) => pool.mesh.geometry)).forEach((geometry) => geometry.dispose());
    this.pools.forEach(({ mesh }) => { (mesh.material as THREE.Material).dispose(); mesh.dispose(); });
    this.scene.clear(); this.pools = []; this.groups.clear(); this.renderer.dispose();
  }
}
