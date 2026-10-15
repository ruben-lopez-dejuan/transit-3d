/**
 * Zen mode: only the network in motion. Every text on the map goes (street and place names of
 * the basemap, vehicle and stop names, cluster counts) and so do the stop dots; vehicles,
 * buildings, the selected line and the user's location stay.
 */
type StyleLayer = { id: string; type: string; layout?: object };
type LayerMap = {
  getStyle(): { layers?: StyleLayer[] } | undefined;
  getLayer(id: string): unknown;
  getLayoutProperty(id: string, name: string): unknown;
  setLayoutProperty(id: string, name: string, value: unknown): unknown;
};

/** Our own layers hidden although they hold no text. */
const ZEN_HIDDEN_LAYERS = new Set(['stations', 'bus-stops']);

export function zenHiddenLayers(layers: readonly StyleLayer[]) {
  return layers.filter((layer) => ZEN_HIDDEN_LAYERS.has(layer.id) || (layer.type === 'symbol' && !!layer.layout && 'text-field' in layer.layout)).map((layer) => layer.id);
}

/** Hides those layers and gives each back the visibility it had, which the basemap may set to none. */
export class ZenLayers {
  private readonly previous = new Map<string, unknown>();
  apply(map: LayerMap, enabled: boolean) {
    if (!enabled) {
      for (const [id, visibility] of this.previous) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility ?? 'visible');
      this.previous.clear();
      return;
    }
    for (const id of zenHiddenLayers(map.getStyle()?.layers ?? [])) {
      if (!this.previous.has(id)) this.previous.set(id, map.getLayoutProperty(id, 'visibility'));
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  }
  /** A new style (theme change) comes with its own layers and visibilities. */
  reset() { this.previous.clear(); }
}

/** Z toggles zen mode, but not while typing or as part of a shortcut such as Ctrl+Z. */
export function isZenShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>, target: { tagName?: string; isContentEditable?: boolean } | null) {
  if (event.key !== 'z' && event.key !== 'Z') return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  return !target?.isContentEditable && !['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '');
}
