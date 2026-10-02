import type { Coordinate, ShapeMetric } from './motionEngine';
import type { Shape } from '../../shared/transit/network';

type Range = NonNullable<Shape['underground']>[number];
type Point = { x: number; y: number };
type Segment = { a: Point; dx: number; dy: number; length: number; component: number };

/** Match infrastructure to the existing GTFS shape, without changing its coordinates. */
export class TunnelGeometryIndex {
  private readonly cells = new Map<string, Segment[]>();
  private readonly cache = new WeakMap<ShapeMetric, Range[]>();
  private readonly lonScale: number;
  private readonly origin: Coordinate;
  private readonly cellMeters = 200;
  constructor(lines: readonly (readonly Coordinate[])[], private readonly depthMeters = 12, private readonly toleranceMeters = 25) {
    this.origin = lines.find((line) => line.length)?.[0] ?? [0, 0];
    this.lonScale = 111_320 * Math.cos(this.origin[1] * Math.PI / 180);
    // Source ways are split at stations/tag changes. Join only shared source nodes.
    const parent = lines.map((_, i) => i), nodes = new Map<string, number>();
    const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
    lines.forEach((line, i) => line.forEach((coordinate) => {
      const key = coordinate.join(':');
      const other = nodes.get(key);
      if (other !== undefined) parent[root(i)] = root(other);
      nodes.set(key, i);
    }));
    for (const [lineIndex, line] of lines.entries()) for (let i = 1; i < line.length; i++) {
      const a = this.point(line[i - 1]), b = this.point(line[i]);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length === 0) continue;
      const segment = { a, dx, dy, length, component: root(lineIndex) };
      const minX = Math.floor((Math.min(a.x, b.x) - toleranceMeters) / this.cellMeters), maxX = Math.floor((Math.max(a.x, b.x) + toleranceMeters) / this.cellMeters);
      const minY = Math.floor((Math.min(a.y, b.y) - toleranceMeters) / this.cellMeters), maxY = Math.floor((Math.max(a.y, b.y) + toleranceMeters) / this.cellMeters);
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
        const key = x + ':' + y;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key)!.push(segment);
      }
    }
  }
  private point(coordinate: Coordinate): Point {
    return { x: (coordinate[0] - this.origin[0]) * this.lonScale, y: (coordinate[1] - this.origin[1]) * 110_540 };
  }
  private matches(point: Point, dx: number, dy: number) {
    const length = Math.hypot(dx, dy);
    const segments = this.cells.get(Math.floor(point.x / this.cellMeters) + ':' + Math.floor(point.y / this.cellMeters)) ?? [];
    return segments.find((segment) => {
      // Both senses match; crossings and nearby tracks with another tangent do not.
      const alignment = Math.abs(dx * segment.dx + dy * segment.dy) / (length * segment.length);
      if (alignment < Math.cos(Math.PI / 6)) return false;
      const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * segment.dx + (point.y - segment.a.y) * segment.dy) / segment.length ** 2));
      return Math.hypot(point.x - segment.a.x - t * segment.dx, point.y - segment.a.y - t * segment.dy) <= this.toleranceMeters;
    });
  }
  private supportedGap(points: Point[], component: number) {
    // GTFS sometimes deviates from the mapped tunnel axis. A gap may be bridged
    // only along one connected source tunnel, with a conservative 250 m envelope.
    return points.every((point) => {
      const x = Math.floor(point.x / this.cellMeters), y = Math.floor(point.y / this.cellMeters);
      for (let cx = x - 2; cx <= x + 2; cx++) for (let cy = y - 2; cy <= y + 2; cy++) {
        for (const segment of this.cells.get(cx + ':' + cy) ?? []) {
          if (segment.component !== component) continue;
          const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * segment.dx + (point.y - segment.a.y) * segment.dy) / segment.length ** 2));
          if (Math.hypot(point.x - segment.a.x - t * segment.dx, point.y - segment.a.y - t * segment.dy) <= 250) return true;
        }
      }
      return false;
    });
  }
  rangesFor(metric: ShapeMetric): Range[] {
    const cached = this.cache.get(metric);
    if (cached) return cached;
    const ranges: (Range & { component: number })[] = [];
    let lastPoint: Point | null = null;
    let gap: Point[] = [];
    for (let i = 1; i < metric.coordinates.length; i++) {
      const start = metric.cumulativeMeters[i - 1], span = metric.cumulativeMeters[i] - start;
      if (!Number.isFinite(span) || span <= 0) continue;
      const a = this.point(metric.coordinates[i - 1]), b = this.point(metric.coordinates[i]);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx === 0 && dy === 0) continue;
      const samples = Math.ceil(span / 10); // Portal bounds approximate to 10 m plus matching tolerance.
      for (let step = 0; step < samples; step++) {
        const t = (step + .5) / samples;
        const point = { x: a.x + t * dx, y: a.y + t * dy };
        const match = this.matches(point, dx, dy);
        if (!match) { if (lastPoint) gap.push(point); continue; }
        const from = start + span * step / samples, to = start + span * (step + 1) / samples;
        const previous = ranges.at(-1);
        // Reject excursions returning to the same portal, such as an above-ground terminus.
        const continuous = previous?.component === match.component && lastPoint !== null
          && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= .5 * (from - previous.to)
          && this.supportedGap(gap, match.component);
        if (previous && (Math.abs(previous.to - from) < .001 || continuous)) { previous.to = to; previous.component = match.component; }
        else ranges.push({ from, to, depthMeters: this.depthMeters, approximate: true, component: match.component });
        lastPoint = point; gap = [];
      }
    }
    const result = ranges.filter((range) => range.to - range.from >= 30).map(({ component: _component, ...range }) => range);
    this.cache.set(metric, result);
    return result;
  }
}
