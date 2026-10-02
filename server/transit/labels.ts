// Some GTFS headsigns contain a service-calendar prefix around the destination.
// Preserve other headsigns verbatim; this is presentation cleanup, not routing.
export { placeShortcuts } from '../cities/es-bilbao/places';

export function passengerHeadsign(value: string, fallback = value): string {
  const destination = /^PT-[^/]+\/\s*\(([^)]+)\)/i.exec(value.trim());
  return destination?.[1].trim() || (/^PT-[A-Z0-9-]+$/i.test(value.trim()) ? fallback : value);
}

