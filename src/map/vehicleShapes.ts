import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_MIN_ZOOM, MODEL_DETAIL_ZOOM, MODEL_FULL_ZOOM } from './vehicleLod';
import type { CabShape, LiveryBand, VehicleBody, VehicleKind } from '../../shared/transit/contracts';

/**
 * Which cars of a consist a part belongs to. A train has a cab at each end: its tail car is a
 * lead car turned round, with red lights. CENTRE marks the middle car (a tram's pantograph).
 */
export const LEAD = 1, MIDDLE = 2, TAIL = 4, SINGLE = 8, CENTRE = 16, EVERY = 31;
export function carRole(car: number, count: number) {
  const role = count === 1 ? SINGLE : car === 0 ? LEAD : car === count - 1 ? TAIL : MIDDLE;
  return role | (count > 1 && car === Math.floor(count / 2) ? CENTRE : 0);
}
/** Tinted parts take the livery: the body colour, its band or the front end. */
export type Tint = 'body' | 'accent' | 'front';
/** One instanced mesh: the cars it is drawn on (`on`) and between which zooms. */
export type Part = { geometry: THREE.BufferGeometry; color: string; tinted?: Tint; minZoom: number; maxZoom?: number; on: number };

const far = MODEL_MIN_ZOOM, medium = MODEL_DETAIL_ZOOM, close = MODEL_FULL_ZOOM;
/** Every piece as plain triangles with normals, so pieces of one colour merge into one mesh. */
function plain(geometry: THREE.BufferGeometry) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  result.deleteAttribute('uv');
  return result;
}
const box = (x: number, y: number, z: number, px = 0, py = 0, pz = 0) => plain(new THREE.BoxGeometry(x, y, z).translate(px, py, pz));
const merge = (...pieces: THREE.BufferGeometry[]) => {
  const result = mergeGeometries(pieces.map(plain))!; pieces.forEach((piece) => piece.dispose()); return result;
};
/** A thin bar from one point to another in the y–z plane (pantograph arms). */
function bar(x: number, [y0, z0]: [number, number], [y1, z1]: [number, number], thickness = .07) {
  const geometry = new THREE.BoxGeometry(thickness, Math.hypot(y1 - y0, z1 - z0), thickness);
  geometry.rotateX(Math.atan2(z1 - z0, y1 - y0)); return plain(geometry.translate(x, (y0 + y1) / 2, (z0 + z1) / 2));
}
function wheel(x: number, y: number) {
  const geometry = new THREE.CylinderGeometry(.48, .48, .22, 8);
  geometry.rotateZ(Math.PI / 2); return plain(geometry.translate(x, y, .55));
}

/** A cross-section of the body at one point along the car, in metres. */
type Station = { y: number; half: number; bottom: number; top: number; shoulder: number };
/** The section's outline across the car, as convex (x, z) points. */
type Section = (station: Station) => [number, number][];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function stationAt(stations: Station[], y: number): Station {
  const i = Math.max(1, stations.findIndex((s) => s.y >= y)), a = stations[i - 1], b = stations[i], t = (y - a.y) / (b.y - a.y || 1);
  return { y, half: lerp(a.half, b.half, t), bottom: lerp(a.bottom, b.bottom, t), top: lerp(a.top, b.top, t), shoulder: lerp(a.shoulder, b.shoulder, t) };
}
const shoulderOf = ({ half, bottom, top, shoulder }: Station) => Math.min(shoulder, half * .9, (top - bottom) * .45);
/** The body: straight sides, rounded roof edges. */
const hull: Section = (s) => {
  const r = shoulderOf(s), { half, bottom, top } = s;
  return [[half, bottom], [half, top - r], [half - r * .3, top - r * .3], [half - r, top], [-half + r, top], [-half + r * .3, top - r * .3], [-half, top - r], [-half, bottom]];
};
/** A band of the sides between two heights, standing `out` proud of the body. */
const slab = (range: (s: Station) => [number, number], out: number): Section => (s) => {
  const [low, high] = range(s), z0 = Math.max(low, s.bottom + .01), z1 = Math.max(z0 + .03, Math.min(high, s.top - shoulderOf(s))), x = s.half + out;
  return [[x, z0], [x, z1], [-x, z1], [-x, z0]];
};
/**
 * Lofts a section through the stations, closing the ends asked for. Every triangle faces out
 * from the car's axis: the sections are convex, so the winding needs no bookkeeping.
 */
function loft(stations: Station[], section: Section, caps: [boolean, boolean], out = 0) {
  const ends = stations.map((s, i) => i === 0 ? { ...s, y: s.y - out } : i === stations.length - 1 ? { ...s, y: s.y + out } : s);
  const rings = ends.map((s) => section(s).map(([x, z]) => new THREE.Vector3(x, s.y, z)));
  const centre = (ring: THREE.Vector3[]) => ring.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(ring.length);
  const triangles: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  const n = rings[0].length, ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 1; i < rings.length; i++) {
    const axis = centre(rings[i - 1]).add(centre(rings[i])).multiplyScalar(.5);
    for (let k = 0; k < n; k++) {
      const a = rings[i - 1][k], b = rings[i - 1][(k + 1) % n], c = rings[i][(k + 1) % n], d = rings[i][k];
      for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
        const middle = p.clone().add(q).add(r).divideScalar(3);
        triangles.push([p, q, r, middle.sub(new THREE.Vector3(axis.x, middle.y, axis.z))]);
      }
    }
  }
  for (const [index, neighbour] of [[0, 1], [rings.length - 1, rings.length - 2]] as const) if (caps[index === 0 ? 0 : 1]) {
    const ring = rings[index], middle = centre(ring), outward = middle.clone().sub(centre(rings[neighbour]));
    ring.forEach((p, k) => triangles.push([middle, p, ring[(k + 1) % n], outward]));
  }
  const positions: number[] = [];
  for (const [p, q, r, outward] of triangles) {
    ab.subVectors(q, p); ac.subVectors(r, p);
    const normal = ab.clone().cross(ac);
    if (normal.lengthSq() < 1e-10) continue;
    const [second, third] = normal.dot(outward) >= 0 ? [q, r] : [r, q];
    positions.push(p.x, p.y, p.z, second.x, second.y, second.z, third.x, third.y, third.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Cab ends, after the fleets: [distance from the nose, share of the half-width, roof drop,
 * chin rise] in metres, and how far along the side the cab's own colour runs.
 */
const NOSES: Record<CabShape, { tint: number; profile: [number, number, number, number][] }> = {
  // Metro Bilbao: an upright front rounded in plan, its dark nose ending where the sides begin.
  round: { tint: 1.45, profile: [[1.5, 1, 0, 0], [.8, .96, .04, 0], [.35, .86, .16, .05], [.1, .74, .3, .12], [0, .62, .4, .2]] },
  // Euskotren 900/950: a long raked nose under its mask.
  sloped: { tint: 1.9, profile: [[2.4, 1, 0, 0], [1.6, .97, .1, 0], [.9, .9, .42, .03], [.4, .8, .8, .08], [0, .66, 1.1, .18]] },
  // Renfe 446/447: an upright cab, its red wrapping round onto the sides.
  flat: { tint: 2.1, profile: [[.6, 1, 0, 0], [.15, .95, .1, 0], [0, .88, .18, .03]] },
  // Artxanda's funicular: a glazed end.
  cabin: { tint: .25, profile: [[.5, 1, 0, 0], [0, .9, .12, 0]] },
};
/** Stations from the rear of the car to its front, with a cab at the ends that have one. */
function stationsFor(base: Omit<Station, 'y'>, length: number, cab: CabShape, [rearCab, frontCab]: [boolean, boolean]) {
  const front = length / 2 - .1, rear = -front, profile = NOSES[cab].profile;
  const at = (y: number, [, share, drop, rise]: [number, number, number, number]) => ({ ...base, y, half: base.half * share, top: base.top - drop, bottom: base.bottom + rise });
  const ends = [...(rearCab ? [...profile].reverse().map((p) => at(rear + p[0], p)) : [at(rear, [0, 1, 0, 0])]), ...(frontCab ? profile.map((p) => at(front - p[0], p)) : [at(front, [0, 1, 0, 0])])];
  return { stations: ends, front, rear };
}
/** The stations between two points along the car, cut exactly at both. */
function between(stations: Station[], from: number, to: number) {
  return [stationAt(stations, from), ...stations.filter((s) => s.y > from + 1e-6 && s.y < to - 1e-6), stationAt(stations, to)];
}

const GLASS = '#1b2328', DARK = '#2a3238', UNDERFRAME = '#20292e', ROOF_KIT = '#a9b2b7';
function pantograph(y: number, top: number) {
  return merge(
    box(1.1, .9, .1, 0, y, top + .05),
    bar(-.35, [y - .45, top + .1], [y + .25, top + .62]), bar(.35, [y - .45, top + .1], [y + .25, top + .62]),
    bar(0, [y + .25, top + .62], [y - .3, top + 1.08]),
    box(1.5, .14, .07, 0, y - .3, top + 1.1),
  );
}

/** The parts of one car of a rail fleet, by role: lead (and turned-round tail), middle and single. */
function railParts(kind: VehicleKind, band: LiveryBand, body: VehicleBody, length: number, gap: number): Part[] {
  const tram = kind === 'tram', funicular = kind === 'funicular';
  const bottom = tram ? .35 : funicular ? .45 : kind === 'metro' ? .85 : .95, top = body.height, shoulder = tram || funicular ? .3 : .4;
  const base = { half: body.width / 2, bottom, top, shoulder };
  const windowTop = top - shoulder - .12, windowBottom = windowTop - (funicular ? 1.35 : tram ? 1.1 : .95);
  const bandRange: [number, number] = band === 'broad' ? [bottom + .02, windowBottom - .12] : band === 'skirt' ? [bottom + .12, bottom + .5] : [windowBottom - .45, windowBottom - .2];
  // The glazing drops with a raked roof: on a sloped nose it becomes the windscreen.
  const glazing = (s: Station): [number, number] => { const high = Math.min(windowTop, s.top - shoulderOf(s) - .04); return [Math.min(windowBottom, high - .75), high]; };
  const result: Part[] = [];
  const roles: [number, [boolean, boolean]][] = funicular ? [[SINGLE, [true, true]]] : [[LEAD | TAIL, [false, true]], [MIDDLE, [false, false]], [SINGLE, [true, true]]];
  for (const [on, cabs] of roles) {
    const { stations, front, rear } = stationsFor(base, length, body.cab, cabs), tint = NOSES[body.cab].tint;
    const bodyFrom = cabs[0] ? rear + tint : rear, bodyTo = cabs[1] ? front - tint : front;
    result.push({ geometry: loft(between(stations, bodyFrom, bodyTo), hull, [!cabs[0], !cabs[1]]), color: '#fff', tinted: 'body', minZoom: far, on });
    // The cab end in its own colour: Metro Bilbao's dark nose, Renfe's red cab, Euskotren's mask.
    const cabsGeometry = [cabs[0] && loft(between(stations, rear, bodyFrom), hull, [true, false]), cabs[1] && loft(between(stations, bodyTo, front), hull, [false, true])].filter((g): g is THREE.BufferGeometry => !!g);
    if (cabsGeometry.length) result.push({ geometry: merge(...cabsGeometry), color: '#fff', tinted: 'front', minZoom: far, on });
    result.push({ geometry: loft(stations, slab(() => bandRange, .03), [true, true], .03), color: '#fff', tinted: 'accent', minZoom: far, on });
    // A continuous dark glazing band, as on the real cars, that wraps round into the windscreen.
    result.push({ geometry: loft(stations, slab(glazing, .04), [true, true], .04), color: GLASS, minZoom: medium, on });

    // Doors: plug doors a shade darker than the body, with their windows, spread over the saloon.
    const cabLength = Math.max(2.6, NOSES[body.cab].profile[0][0] + .9), saloonFrom = cabs[0] ? rear + cabLength : rear + .9, saloonTo = cabs[1] ? front - cabLength : front - .9;
    const doorWidth = funicular ? 1 : 1.3, doorBottom = bottom + (tram ? .05 : .08), doorTop = windowTop + .05;
    const doors: number[] = Array.from({ length: body.doors }, (_, i) => saloonFrom + (i + .5) * (saloonTo - saloonFrom) / body.doors);
    const sides = [-1, 1], half = body.width / 2;
    result.push({ geometry: merge(...doors.flatMap((y) => sides.map((side) => box(.03, doorWidth, doorTop - doorBottom, side * (half + .05), y, (doorBottom + doorTop) / 2)))), color: '#d3d8dc', tinted: 'body', minZoom: medium, on });
    result.push({ geometry: merge(...doors.flatMap((y) => sides.flatMap((side) => [-1, 1].map((leaf) => box(.03, doorWidth / 2 - .16, windowTop - windowBottom + .1, side * (half + .065), y + leaf * doorWidth / 4, (windowBottom + windowTop) / 2 - .05))))), color: GLASS, minZoom: medium, on });

    // Gangways (a tram's articulation) between cars, half the gap from each car.
    const reach = (.2 + gap) / 2 + .08, ends = [!cabs[0] && rear - reach / 2, !cabs[1] && front + reach / 2].filter((y): y is number => y !== false);
    if (ends.length) result.push({ geometry: merge(...ends.map((y) => box(body.width * (tram ? .92 : .84), reach, top - (tram ? .2 : .3) - bottom - .05, 0, y, (bottom + .05 + top - (tram ? .2 : .3)) / 2))), color: DARK, minZoom: medium, on });
    // Bogies under the floor; a low-floor tram hides its wheels behind the skirt.
    if (!tram) result.push({ geometry: merge(...[rear + 2.8, front - 2.8].map((y) => box(body.width * .78, 2.5, bottom - .15, 0, y, (bottom + .15) / 2))), color: UNDERFRAME, minZoom: medium, on });
    // Roof equipment: air-conditioning units on trains; a tram's long roof fairing.
    if (tram) result.push({ geometry: box(body.width * .62, length * .55, .34, 0, 0, top + .14), color: '#d8dde0', minZoom: medium, on });
    else if (!funicular) result.push({ geometry: merge(box(body.width * .5, 1.9, .3, 0, -length / 4, top + .12), box(body.width * .5, 1.9, .3, 0, length / 4, top + .12)), color: ROOF_KIT, minZoom: close, on });
    // Pantographs: over the inner end of each cab car on trains, on the middle module of a tram.
    if (!tram && !funicular && on & LEAD) result.push({ geometry: pantograph(rear + 2.4, top + .02), color: '#33424a', minZoom: close, on });

    // Lights on each cab face: white at the front, red at the rear; a lit destination sign above.
    const lights = (y: number, s: Station) => sides.map((side) => box(.34, .08, .16, side * s.half * .6, y, s.bottom + .32));
    const sign = (y: number, s: Station) => box(Math.min(1, s.half), .08, .18, 0, y, glazing(s)[1] - .14);
    const frontFace = stations.at(-1)!, rearFace = stations[0];
    if (cabs[1]) {
      result.push({ geometry: merge(...lights(front + .02, frontFace)), color: '#fff5c5', minZoom: close, on: on & ~TAIL });
      if (on & TAIL) result.push({ geometry: merge(...lights(front + .02, frontFace)), color: '#e73939', minZoom: close, on: TAIL });
      result.push({ geometry: sign(front + .03, frontFace), color: '#f6a723', minZoom: close, on });
    }
    if (cabs[0]) result.push({ geometry: merge(...lights(rear - .02, rearFace)), color: '#e73939', minZoom: close, on }, { geometry: sign(rear - .03, rearFace), color: '#f6a723', minZoom: close, on });
  }
  if (tram) result.push({ geometry: pantograph(.6, top + .32), color: '#33424a', minZoom: close, on: CENTRE });
  return result;
}

/**
 * Where a bus's band runs, after the real fleets: low on the skirt, over the whole lower half
 * (Bizkaibus's green) or as a thin line (Bilbobus, Dbus).
 */
function busParts(band: LiveryBand): Part[] {
  const [z, h] = band === 'broad' ? [1.12, 1.1] : band === 'skirt' ? [.78, .45] : [1.05, .32];
  return [
    { geometry: merge(box(2.5, 10.8, 2.35, 0, -.3, 1.8), box(2.3, .9, 2.15, 0, 5.45, 1.7)), color: '#fff', tinted: 'body', minZoom: far, on: EVERY },
    { geometry: merge(box(.05, 10.2, h, -1.27, -.4, z), box(.05, 10.2, h, 1.27, -.4, z), box(2.3, .05, h, 0, 5.92, z), box(2.3, .05, h, 0, -5.72, z)), color: '#fff', tinted: 'accent', minZoom: far, on: EVERY },
    { geometry: box(2.2, 8.5, .22, 0, -.3, 3.1), color: '#e4eaea', tinted: 'body', minZoom: far, on: EVERY },
    { geometry: merge(box(.04, 8.7, .85, -1.27, -.3, 2.15), box(.04, 8.7, .85, 1.27, -.3, 2.15), box(2.08, .06, 1.1, 0, 5.93, 2.12)), color: GLASS, minZoom: medium, on: EVERY },
    { geometry: merge(wheel(-1.27, 3.1), wheel(1.27, 3.1), wheel(-1.27, -3.9), wheel(1.27, -3.9)), color: '#17252d', minZoom: medium, on: EVERY },
    { geometry: merge(box(.4, .08, .18, -.8, 5.96, .85), box(.4, .08, .18, .8, 5.96, .85)), color: '#fff5c5', minZoom: close, on: EVERY },
    { geometry: merge(box(.25, .08, .35, -.95, -5.74, .85), box(.25, .08, .35, .95, -5.74, .85)), color: '#e73939', minZoom: close, on: EVERY },
  ];
}

/**
 * Seen from above at a distance only the roof shows, and a white Bizkaibus looks like any other
 * vehicle. Until the close views, the livery's band also runs along the roof edges, as on the
 * icons: wide for a band over the lower half (Bizkaibus's green), narrow otherwise.
 */
function roofLivery(kind: VehicleKind, band: LiveryBand, body: VehicleBody, length: number): Part {
  const bus = kind === 'bus', width = bus ? 2.3 : body.width - .8, z = bus ? 3.24 : body.height + .01;
  const stripe = width * (band === 'broad' ? .3 : bus ? .17 : .1), x = width / 2 - stripe / 2, along = length - (bus ? 1.6 : 1.2);
  return { geometry: merge(box(stripe, along, .04, -x, bus ? -.3 * length / 12 : 0, z), box(stripe, along, .04, x, bus ? -.3 * length / 12 : 0, z)), color: '#fff', tinted: 'accent', minZoom: far, maxZoom: close, on: EVERY };
}

/**
 * Every part of one fleet's cars, in metres (y along the car, its centre at 0), with pieces of
 * one colour, detail level and role merged into a single mesh to keep draw calls low.
 */
export function vehicleParts(kind: VehicleKind, band: LiveryBand, body: VehicleBody, length: number, gap: number): Part[] {
  const parts = kind === 'bus' ? busParts(band).map((part) => ({ ...part, geometry: part.geometry.scale(1, length / 12, 1) })) : railParts(kind, band, body, length, gap);
  parts.push(roofLivery(kind, band, body, length));
  const merged = new Map<string, Part[]>();
  for (const part of parts) {
    const key = `${part.color}|${part.tinted}|${part.minZoom}|${part.maxZoom}|${part.on}`;
    merged.set(key, [...merged.get(key) ?? [], part]);
  }
  return [...merged.values()].map((same) => same.length === 1 ? same[0] : { ...same[0], geometry: merge(...same.map((part) => part.geometry)) });
}
