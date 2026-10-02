import type { BizkaibusGtfs, GtfsTrip } from "../providers/bizkaibus/gtfs";

export type ServiceDate = { date: string; weekday: number };
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatServiceDate(date: Date, timeZone = "Europe/Madrid"): ServiceDate {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }); dateFormatters.set(timeZone, formatter); }
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  const weekdayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { date: `${part("year")}${part("month")}${part("day")}`, weekday: weekdayIndex[part("weekday")] };
}

export function isServiceActive(gtfs: Pick<BizkaibusGtfs, "calendars" | "calendarDates">, serviceId: string, date: string, weekday: number): boolean {
  const exception = gtfs.calendarDates.get(serviceId)?.get(date);
  if (exception === 1) return true;
  if (exception === 2) return false;
  const calendar = gtfs.calendars.get(serviceId);
  return Boolean(calendar && date >= calendar.startDate && date <= calendar.endDate && calendar.weekdays[weekday]);
}

export function getActiveTrips(gtfs: Pick<BizkaibusGtfs, "trips" | "calendars" | "calendarDates">, date: string, weekday: number): GtfsTrip[] {
  const serviceIds = new Set<string>(gtfs.calendars.keys());
  for (const id of gtfs.calendarDates.keys()) serviceIds.add(id);
  const active = new Set([...serviceIds].filter((id) => isServiceActive(gtfs, id, date, weekday)));
  return [...gtfs.trips.values()].filter((trip) => active.has(trip.serviceId));
}

export function parseGtfsTime(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]); const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function serviceSecondsAt(date: Date, timeZone = "Europe/Madrid"): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)!.value);
  return part("hour") * 3600 + part("minute") * 60 + part("second");
}

export function previousServiceDate(date: string): ServiceDate {
  const parsed = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) - 1));
  const weekday = parsed.getUTCDay();
  return { date: `${parsed.getUTCFullYear()}${String(parsed.getUTCMonth() + 1).padStart(2, "0")}${String(parsed.getUTCDate()).padStart(2, "0")}`, weekday: weekday === 0 ? 6 : weekday - 1 };
}
