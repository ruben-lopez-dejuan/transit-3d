/** Line icons on a 24 px grid, drawn with currentColor so they follow the theme. */
const svg = (body: string, label?: string) => `<svg class="icon" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${body}</svg>`;

const paths = {
  all: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  bus: '<rect x="4.5" y="3" width="15" height="15" rx="3.5"/><path d="M4.5 11h15M8 21v-3M16 21v-3"/><path d="M8.5 6.5h7"/><circle cx="8.3" cy="14.5" r=".9" class="fill"/><circle cx="15.7" cy="14.5" r=".9" class="fill"/>',
  metro: '<path d="M7 3.5h10a3 3 0 0 1 3 3V15a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15V6.5a3 3 0 0 1 3-3Z"/><path d="M4 11h16M12 3.5V11"/><circle cx="8" cy="14.3" r=".9" class="fill"/><circle cx="16" cy="14.3" r=".9" class="fill"/><path d="m8 17.5-2.5 3.5M16 17.5l2.5 3.5M7.2 20h9.6"/>',
  train: '<path d="M8 3h8l2.5 3.5V15A2.5 2.5 0 0 1 16 17.5H8A2.5 2.5 0 0 1 5.5 15V6.5Z"/><path d="M6.5 7h11v4h-11Z"/><circle cx="8.6" cy="14.3" r=".9" class="fill"/><circle cx="15.4" cy="14.3" r=".9" class="fill"/><path d="m8 17.5-2.5 3.5M16 17.5l2.5 3.5M7.2 20h9.6"/>',
  tram: '<path d="M9 2.5h6M12 2.5V5"/><rect x="5.5" y="5" width="13" height="12.5" rx="3"/><path d="M5.5 11h13"/><circle cx="8.8" cy="14.3" r=".9" class="fill"/><circle cx="15.2" cy="14.3" r=".9" class="fill"/><path d="m8.5 17.5-2 3.5M15.5 17.5l2 3.5"/>',
  funicular: '<path d="M2.5 20.5 21.5 7"/><path d="m7 15.2 10-7.1 1.6 2.3v3.2l-8.2 5.8H7.8L6.1 17Z"/><path d="m10.6 12.7 1.9 2.7M14.2 10.2l1.9 2.7"/>',
  stop: '<path d="M12 21v-9"/><rect x="7" y="3" width="10" height="9" rx="2.5"/><path d="M9.8 7.5h4.4"/>',
  place: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5"/>',
} as const;
export type IconName = keyof typeof paths;
export const icon = (name: IconName, label?: string) => svg(paths[name], label);
/** The icon for a vehicle or route kind (metro and train differ; rail without a kind is a train). */
export const kindIcon = (kind: string) => icon(kind === 'bus' || kind === 'metro' || kind === 'tram' || kind === 'funicular' ? kind : 'train');
