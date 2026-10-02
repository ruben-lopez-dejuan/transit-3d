import type { Network, Route, Stop, Place, TransitMode } from "./networkTypes";
export type SearchResult = { type: "route"; item: Route } | { type: "stop"; item: Stop } | { type: "place"; item: Place };
export const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function searchNetwork(network: Network, query: string, mode: TransitMode | "all", operators: Set<string>, disabled = new Set<string>()): SearchResult[] {
  const term = fold(query);
  if (!term) return [];
  const score = (label: string, text: string) => fold(label) === term ? 0 : fold(label).startsWith(term) ? 1 : fold(text).includes(term) ? 2 : 99;
  const routes = network.routes.filter((r) => operators.has(r.operatorId) && !disabled.has(r.operatorId + ':' + r.mode) && (mode === "all" || r.mode === mode)).map((r) => ({ item: r, score: score(r.shortName, `${r.shortName} ${r.longName}`) })).filter((r) => r.score < 99).sort((a, b) => a.score - b.score).slice(0, 6).map(({ item }) => ({ type: "route" as const, item }));
  const stops = network.stops.filter((s) => operators.has(s.operatorId) && s.modes.some((m) => !disabled.has(s.operatorId + ':' + m)) && (mode === "all" || s.modes.includes(mode))).map((s) => ({ item: s, score: score(s.name, s.name) })).filter((s) => s.score < 99).sort((a, b) => a.score - b.score).slice(0, 8).map(({ item }) => ({ type: "stop" as const, item }));
  const places = network.places.filter((p) => fold(p.name).includes(term)).slice(0, 4).map((item) => ({ type: "place" as const, item }));
  return [...routes, ...stops, ...places];
}
