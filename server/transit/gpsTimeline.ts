type Anchor = { at: number; progress: number };

/** GPS anchors a forecast at its source instant, never at the HTTP query instant. */
export function anchorGpsTimeline(timeline: Anchor[], observation: Anchor): Anchor[] {
  return [observation, ...timeline.filter((a) => a.at > observation.at && a.progress >= observation.progress)];
}
