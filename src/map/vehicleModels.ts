import { MercatorCoordinate, type Map as TransitMap, type CustomLayerInterface, type CustomRenderMethodInput } from 'maplibre-gl';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_CAPACITY, MODEL_MIN_ZOOM, MODEL_DETAIL_ZOOM, MODEL_FULL_ZOOM, type VehicleKind } from './vehicleLod';

export type ModelItem = {
  coordinate: [number, number]; bearing: number; color: string; length: number;
  kind: VehicleKind; altitude: number; underground: boolean; selected: boolean;
  scale: { width: number; length: number; height: number };
};
type Part = { geometry: THREE.BufferGeometry; color: string; tinted?: boolean; minZoom: number };
type Pool = { mesh: THREE.InstancedMesh; capacity: number; minZoom: number; tinted: boolean };
const box = (x: number, y: number, z: number, px = 0, py = 0, pz = 0) => new THREE.BoxGeometry(x, y, z).translate(px, py, pz);
const merge = (...pieces: THREE.BufferGeometry[]) => {
  const result = mergeGeometries(pieces)!; pieces.forEach((piece) => piece.dispose()); return result;
};
function wheel(x: number, y: number) {
  const geometry = new THREE.CylinderGeometry(.48, .48, .22, 8);
  geometry.rotateZ(Math.PI / 2); return geometry.translate(x, y, .55);
}
function railBody(width: number, nose: number, height: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -5.7); shape.lineTo(width / 2, -5.7);
  shape.lineTo(width / 2, 4.9); shape.lineTo(nose / 2, 6);
  shape.lineTo(-nose / 2, 6); shape.lineTo(-width / 2, 4.9); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 }).translate(0, 0, .6);
}
function parts(kind: VehicleKind): Part[] {
  const far = MODEL_MIN_ZOOM, medium = MODEL_DETAIL_ZOOM, close = MODEL_FULL_ZOOM;
  if (kind === 'bus') return [
    { geometry: merge(box(2.5, 10.8, 2.35, 0, -.3, 1.8), box(2.3, .9, 2.15, 0, 5.45, 1.7)), color: '#fff', tinted: true, minZoom: far },
    { geometry: box(2.2, 8.5, .22, 0, -.3, 3.1), color: '#dce4e4', minZoom: far },
    { geometry: merge(box(.04, 8.7, .85, -1.27, -.3, 2.15), box(.04, 8.7, .85, 1.27, -.3, 2.15), box(2.08, .06, 1.1, 0, 5.93, 2.12)), color: '#203b49', minZoom: medium },
    { geometry: merge(wheel(-1.27, 3.1), wheel(1.27, 3.1), wheel(-1.27, -3.9), wheel(1.27, -3.9)), color: '#17252d', minZoom: medium },
    { geometry: merge(box(.4, .08, .18, -.8, 5.96, .85), box(.4, .08, .18, .8, 5.96, .85)), color: '#fff5c5', minZoom: close },
    { geometry: merge(box(.25, .08, .35, -.95, -5.74, .85), box(.25, .08, .35, .95, -5.74, .85)), color: '#e73939', minZoom: close },
  ];
  const tram = kind === 'tram', metro = kind === 'metro', funicular = kind === 'funicular';
  const width = tram ? 2.4 : 2.7, height = tram ? 2.3 : funicular ? 2.2 : 2.8;
  const nose = metro ? 2.5 : tram ? 1.4 : funicular ? 2.4 : 1.1;
  const result: Part[] = [
    { geometry: railBody(width, nose, height), color: '#fff', tinted: true, minZoom: far },
    { geometry: box(width * .75, metro ? 9 : tram ? 8 : 9.6, .18, 0, -.4, height + .65), color: metro ? '#384a55' : '#dce4e4', minZoom: far },
    { geometry: merge(box(.05, 9, .85, -width / 2 - .02, -.3, height - .2), box(.05, 9, .85, width / 2 + .02, -.3, height - .2), box(nose * .85, .05, .85, 0, 6.03, height - .15)), color: '#253e4c', minZoom: medium },
    { geometry: merge(box(.38, .07, .2, -nose * .3, 6.05, .95), box(.38, .07, .2, nose * .3, 6.05, .95)), color: '#fff5c5', minZoom: close },
    { geometry: merge(box(.08, .07, 1.65, -width / 2 - .04, 1.8, 1.45), box(.08, .07, 1.65, width / 2 + .04, 1.8, 1.45), box(width * .55, 1.4, .28, 0, -.8, height + .85)), color: '#62717b', minZoom: close },
  ];
  if (tram) result.push({ geometry: box(width * .8, .55, height * .8, 0, -5.9, height * .5 + .6), color: '#38434a', minZoom: medium });
  if (tram || funicular) result.push({ geometry: merge(box(.09, 2, .12, -.45, .8, height + 1), box(.09, 2, .12, .45, .8, height + 1), box(1.3, .09, .12, 0, 1.7, height + 1)), color: '#293b43', minZoom: close });
  return result;
}

/** One body per car at every LOD. Extra parts appear, never a second vehicle body. */
export class VehicleModels implements CustomLayerInterface {
  readonly id = 'transit-models'; readonly type = 'custom' as const; readonly renderingMode = '3d' as const;
  ready = false; enabled = false;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene(); private camera = new THREE.Camera();
  private pools: Pool[] = []; private groups = new Map<string, Pool[]>(); private map!: TransitMap;
  private origin!: MercatorCoordinate; private units = 1; private local = new THREE.Matrix4();
  private transform = new THREE.Object3D(); private color = new THREE.Color(); private white = new THREE.Color('#fff');

  onAdd(map: TransitMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map; this.origin = MercatorCoordinate.fromLngLat(map.getCenter()); this.units = this.origin.meterInMercatorCoordinateUnits();
    this.local.makeTranslation(this.origin.x, this.origin.y, 0).multiply(new THREE.Matrix4().makeScale(this.units, -this.units, this.units));
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext }); this.renderer.autoClear = false;
    this.scene.add(new THREE.AmbientLight('#fff', 1.3));
    const light = new THREE.DirectionalLight('#fff', 1.8); light.position.set(-3, 4, 8); this.scene.add(light);
    for (const kind of ['bus', 'train', 'metro', 'tram', 'funicular', 'unknown'] as const) {
      const geometryParts = parts(kind);
      for (const ghost of [false, true]) {
        const group: Pool[] = [];
        for (const part of geometryParts) {
          const material = new THREE.MeshLambertMaterial({ color: part.color, transparent: ghost, opacity: ghost ? .38 : 1, depthTest: !ghost, depthWrite: !ghost });
          const capacity = kind === 'bus' ? 512 : kind === 'train' ? 256 : 128;
          const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
          mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          const pool = { mesh, capacity, minZoom: part.minZoom, tinted: !!part.tinted };
          this.scene.add(mesh); this.pools.push(pool); group.push(pool);
        }
        this.groups.set(kind + ':' + ghost, group);
      }
    }
    this.ready = true;
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

  update(items: ModelItem[], enabled = true) {
    this.enabled = enabled;
    if (!this.ready) return;
    const zoom = this.map.getZoom();
    for (const pool of this.pools) pool.mesh.count = 0;
    // Mercator conversion and matrix happen once per car, once per preparation tick.
    for (const item of items) {
      const coordinate = MercatorCoordinate.fromLngLat(item.coordinate), ratio = coordinate.meterInMercatorCoordinateUnits() / this.units;
      this.transform.position.set((coordinate.x - this.origin.x) / this.units, -(coordinate.y - this.origin.y) / this.units, item.altitude * ratio);
      this.transform.rotation.set(0, 0, -item.bearing * Math.PI / 180);
      this.transform.scale.set(item.scale.width * ratio, item.length / 12 * item.scale.length * ratio, item.scale.height * ratio);
      this.transform.updateMatrix(); this.color.set(item.color); if (item.selected) this.color.lerp(this.white, .18);
      for (const pool of this.groups.get(item.kind + ':' + item.underground) ?? []) {
        if (zoom < pool.minZoom || pool.mesh.count >= MODEL_CAPACITY) continue;
        if (pool.mesh.count >= pool.capacity) this.grow(pool);
        const index = pool.mesh.count++;
        pool.mesh.setMatrixAt(index, this.transform.matrix);
        if (pool.tinted) pool.mesh.setColorAt(index, this.color);
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
    for (const pool of this.pools) pool.mesh.visible = this.map.getZoom() >= pool.minZoom;
    this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.renderer.resetState();
  }

  onRemove() {
    this.ready = false; this.enabled = false;
    new Set(this.pools.map((pool) => pool.mesh.geometry)).forEach((geometry) => geometry.dispose());
    this.pools.forEach(({ mesh }) => { (mesh.material as THREE.Material).dispose(); mesh.dispose(); });
    this.scene.clear(); this.pools = []; this.groups.clear(); this.renderer.dispose();
  }
}
