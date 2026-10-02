import { MercatorCoordinate, type Map, type CustomLayerInterface, type CustomRenderMethodInput } from 'maplibre-gl';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type ModelItem = { coordinate: [number, number]; bearing: number; color: string; length: number; bus: boolean; altitude: number; underground: boolean; scale: number };
type Pool = { mesh: THREE.InstancedMesh; bus: boolean; ghost: boolean; tinted: boolean };
const box = (x: number, y: number, z: number, px = 0, py = 0, pz = 0) => new THREE.BoxGeometry(x, y, z).translate(px, py, pz);
function wheel(x: number, y: number) { const geometry = new THREE.CylinderGeometry(.48, .48, .22, 8); geometry.rotateZ(Math.PI / 2); return geometry.translate(x, y, .55); }
const capacity = 800;
/** Shared low-poly geometry, material and instance buffers: no object per vehicle. */
export class VehicleModels implements CustomLayerInterface {
  readonly id = 'transit-models'; readonly type = 'custom' as const; readonly renderingMode = '3d' as const;
  private renderer!: THREE.WebGLRenderer; private scene = new THREE.Scene(); private camera = new THREE.Camera();
  private pools: Pool[] = []; private items: ModelItem[] = []; private map!: Map;
  private transform = new THREE.Object3D(); private color = new THREE.Color();
  onAdd(map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map; this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext }); this.renderer.autoClear = false;
    const body = mergeGeometries([box(2.5, 10.8, 2.35, 0, -.3, 1.8), box(2.3, .9, 2.15, 0, 5.45, 1.7), box(2.2, 8.5, .22, 0, -.3, 3.1)])!;
    const glass = mergeGeometries([box(.04, 8.7, .85, -1.27, -.3, 2.15), box(.04, 8.7, .85, 1.27, -.3, 2.15), box(2.08, .06, 1.1, 0, 5.93, 2.12)])!;
    const wheels = mergeGeometries([wheel(-1.27, 3.1), wheel(1.27, 3.1), wheel(-1.27, -3.9), wheel(1.27, -3.9)])!;
    const headlights = mergeGeometries([box(.4, .08, .18, -.8, 5.96, .85), box(.4, .08, .18, .8, 5.96, .85)])!;
    const taillights = mergeGeometries([box(.25, .08, .35, -.95, -5.74, .85), box(.25, .08, .35, .95, -5.74, .85)])!;
    const train = mergeGeometries([box(2.7, 11.2, 2.8, 0, 0, 2), box(2.35, .7, 2.4, 0, 5.9, 1.8), box(2.35, .7, 2.4, 0, -5.9, 1.8)])!;
    const trainGlass = mergeGeometries([box(.06, 10.2, 1, -1.37, 0, 2.4), box(.06, 10.2, 1, 1.37, 0, 2.4), box(2.05, .07, .9, 0, 6.27, 2.2), box(2.05, .07, .9, 0, -6.27, 2.2)])!;
    for (const ghost of [false, true]) for (const [bus, geometry, tint, color] of [
      [true, body, true, '#ffffff'], [true, glass, false, '#203b49'], [true, wheels, false, '#17252d'], [true, headlights, false, '#fff5c5'], [true, taillights, false, '#e73939'], [false, train, true, '#ffffff'], [false, trainGlass, false, '#253e4c'],
    ] as const) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: ghost, opacity: ghost ? .32 : 1, depthTest: !ghost, depthWrite: !ghost });
      const mesh = new THREE.InstancedMesh(geometry, material, capacity); mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(mesh); this.pools.push({ mesh, bus, ghost, tinted: tint });
    }
  }
  update(items: ModelItem[]) { this.items = items; }
  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const origin = MercatorCoordinate.fromLngLat(this.map.getCenter()); const units = origin.meterInMercatorCoordinateUnits();
    const local = new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0).multiply(new THREE.Matrix4().makeScale(units, -units, units));
    this.camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
    for (const pool of this.pools) {
      let count = 0;
      for (const item of this.items) {
        if (item.bus !== pool.bus || item.underground !== pool.ghost || count >= capacity) continue;
        const coordinate = MercatorCoordinate.fromLngLat(item.coordinate);
        this.transform.position.set((coordinate.x - origin.x) / units, -(coordinate.y - origin.y) / units, item.altitude);
        this.transform.rotation.set(0, 0, -item.bearing * Math.PI / 180);
        this.transform.scale.set(item.scale, item.length / 12 * item.scale, item.scale); this.transform.updateMatrix();
        pool.mesh.setMatrixAt(count, this.transform.matrix);
        if (pool.tinted) pool.mesh.setColorAt(count, this.color.set(item.color)); count++;
      }
      pool.mesh.count = count; pool.mesh.instanceMatrix.needsUpdate = true; if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    }
    this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.renderer.resetState();
  }
  onRemove() {
    const geometries = new Set(this.pools.map((p) => p.mesh.geometry)); geometries.forEach((g) => g.dispose());
    this.pools.forEach((p) => { (p.mesh.material as THREE.Material).dispose(); p.mesh.dispose(); }); this.pools = []; this.renderer.dispose();
  }
}
