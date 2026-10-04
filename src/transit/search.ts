import type { Network, Route, Stop, Place, TransitMode } from "./networkTypes";
export type SearchResult = { type: "route"; item: Route } | { type: "stop"; item: Stop } | { type: "place"; item: Place };
export const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
type SearchIndex = {
  routes: { item: Route; label: string; text: string }[];
  stops: { item: Stop; label: string }[];
  places: { item: Place; label: string }[];
};
const indexes = new WeakMap<Network, SearchIndex>();
function indexFor(network: Network) {
  let index = indexes.get(network);
  if (!index) {
    index = {
      routes: network.routes.map((item) => ({ item, label: fold(item.shortName), text: fold(`${item.shortName} ${item.longName}`) })),
      stops: network.stops.map((item) => ({ item, label: fold(item.name) })),
      places: network.places.map((item) => ({ item, label: fold(item.name) })),
    };
    indexes.set(network, index);
  }
  return index;
}
export function searchNetwork(network: Network, query: string, mode: TransitMode | "all", operators: Set<string>, disabled = new Set<string>()): SearchResult[] {
  const term = fold(query);
  if (!term) return [];
  const index = indexFor(network);
  const score = (label: string, text: string) => label === term ? 0 : label.startsWith(term) ? 1 : text.includes(term) ? 2 : 99;
  const routes = index.routes.filter(({ item }) => operators.has(item.operatorId) && !disabled.has(item.operatorId + ':' + item.mode) && (mode === "all" || item.mode === mode)).map(({ item, label, text }) => ({ item, score: score(label, text) })).filter((route) => route.score < 99).sort((a, b) => a.score - b.score).slice(0, 6).map(({ item }) => ({ type: "route" as const, item }));
  const stops = index.stops.filter(({ item }) => operators.has(item.operatorId) && item.modes.some((itemMode) => !disabled.has(item.operatorId + ':' + itemMode)) && (mode === "all" || item.modes.includes(mode))).map(({ item, label }) => ({ item, score: score(label, label) })).filter((stop) => stop.score < 99).sort((a, b) => a.score - b.score).slice(0, 8).map(({ item }) => ({ type: "stop" as const, item }));
  const places = index.places.filter((place) => place.label.includes(term)).slice(0, 4).map(({ item }) => ({ type: "place" as const, item }));
  return [...routes, ...stops, ...places];
}
