# Bilbao Transit 3D

Web app for visualising public transport in Bilbao and Bizkaia in real time.

The app includes Bizkaibus, Bilbobus, Metro Bilbao and Euskotren. It opens directly
on the map with active vehicles, mode filters, search and passenger details.

## Architecture

```text
Browser / MapLibre
        |
        | /api/*
        v
Node + Express
        |
        +-- static GTFS
        +-- GTFS-Realtime
        +-- trip_id -> shape_id
        +-- conservative map matching
        v
Moveuskadi Open Data
```

The frontend never downloads GTFS or protobuf feeds directly. All provider-specific
logic lives in the backend.

## Local development

Install dependencies:

```powershell
npm install
```

Run frontend and backend together:

```powershell
npm run dev
```

Then open:

```text
http://localhost:5173
```

The API runs on port 3001 and Vite proxies `/api` automatically.

## Validate data providers

Static GTFS:

```powershell
npm run test:bizkaibus-gtfs
```

Realtime + map matching:

```powershell
npm run test:bizkaibus-realtime
```

## Production-style local run

Build the frontend:

```powershell
npm run build
```

Start the Express app:

```powershell
npm start
```

Then open:

```text
http://localhost:3001
```

When `dist/` exists, Express serves both the API and the built web application.
This is also the simplest deployment model for a Node-compatible web host.

## Bizkaibus positioning

The realtime feed currently provides useful GPS coordinates and `trip_id`, but
does not provide useful route/bearing data for rendering.

The backend therefore:

1. matches `trip_id` against current static GTFS;
2. obtains the exact `shape_id`;
3. uses `stop_id` / `current_stop_sequence` when present to restrict the valid
   part of the shape;
4. penalises implausible jumps relative to the vehicle's previous position;
5. projects only positions within 120 m of the compatible part of the route;
6. discards positions that cannot be reconciled safely.

This is intentionally conservative: a missing bus is preferable to a bus being
shown kilometres away on the wrong part of the map.

## Current UI

- Fullscreen MapLibre map using OpenFreeMap light/dark cartography.
- Primary mode filters: all, bus, metro/train and tram; optional operator layers.
- Local search for lines, stops, stations and a small set of network landmarks.
- Click a vehicle to see its destination, next stop, route and camera follow.
- Click a stop for upcoming services, including stops within 80 meters.
- Open a line to see directions, active vehicles, departures and a reference route.
- Favorite lines/stops and appearance preferences persist locally.
- Desktop sidebar and mobile bottom sheet, with keyboard navigation and labels.
- Zoom-dependent clusters, labels, headings and simple 3D vehicle bodies at zoom 17.
- Hollow markers indicate scheduled positions; recent GPS is filled, predictions
  have an amber outline. Each detail also names the quality in text.
- `?debug=1` shows the selected trip, shape, snapshot progress and observation age.

## Next steps

Connect and validate TripUpdates (especially Euskotren), improve branch-specific
line selection, and profile the renderer on physical Android devices. Capacitor
is not configured yet. This version is a responsive web app, without an A → B
journey planner.

## Core phase implemented

The backend now has a shared provider contract (`TransitProvider`), a
`TransitEngine`, and normalized `TransitVehicle` snapshots exposed at
`/api/transit`. All four operators are registered. Existing Bizkaibus-specific
routes remain available for compatibility; the new frontend uses the common API.

GTFS service calendars and date exceptions are loaded for Bizkaibus. Scheduled
vehicle positions are generated on the trip shape from stop times, and the
normalized model distinguishes `live`, `predicted`, and `scheduled` positions.
Reusable MotionEngine primitives operate on distance along a shape. Their tests
are run with:

```powershell
npm test
```

`docs/architecture.md`, `docs/motion-engine.md`, and `docs/data-sources.md`
describe the current design, engine boundaries, and the actual feed audit.
Bizkaibus uses GPS when fresh, then predictions, then scheduled fallback. Bilbobus,
Metro Bilbao and Euskotren currently use verified static GTFS and are explicitly
marked as scheduled. Published realtime endpoints are documented separately;
their availability is not claimed as implemented GPS.

`server/transit/plans.ts` caches shape metrics and ordered stop plans per feed.
The browser interpolates continuous distance on the route, retains station dwell,
and eases GPS corrections over 5–20 seconds. Polling and rendering are independent.
Next-stop times from GPS are estimates; scheduled departures are not live ETAs.

## Local commands

```powershell
npm install
npm run dev       # Vite frontend + Express API
npm test          # unit tests for calendar and motion core
npm run build     # typecheck and production frontend build
npm start         # serve API and built frontend from dist/
```

The existing download-and-parse smoke checks remain available as
`npm run test:bizkaibus-gtfs` and `npm run test:bizkaibus-realtime`; they need
network access. Source URLs and the audit limits are in
[`docs/data-sources.md`](docs/data-sources.md).

## Web installation and deployment

The production build includes a manifest, 192/512 icons and a service worker.
Serve it with `npm start` behind HTTPS for installation on a phone (localhost
also works for local checks). The install action appears in Capas when the
browser offers installation; iOS uses its Share → Add to Home Screen flow.

The worker caches the application shell and bundled assets. It never caches
`/api/*`, transport feeds or map tiles. Offline mode retains an already loaded
snapshot briefly, displays its age and removes vehicle locations after three
minutes. Opening offline can show the shell, but needs connectivity to obtain
transport data and map tiles.

Deploy the repository to a Node host, install dependencies, run `npm run build`,
then `npm start` with `PORT` set by the host. Allow outbound HTTPS to Moveuskadi
and writable space for `server/cache`. No frontend environment keys are needed.
The initial load parses all feeds and can take tens of seconds. Static timetables
are retained in memory until the backend restarts; restart daily to pick up new
feed releases in this version. Disk downloads use a six-hour freshness window.

`npm run test:frontend` covers search, meter interpolation, dwell, correction,
quality aging and safe feed labels. `npm test` also covers parser/calendar/DST
and provider isolation, without requiring external feeds. MapLibre accounts for
most of the bundle size; Vite currently reports a large-chunk warning.

With the API running, `npm run test:network` checks the actual shared endpoints
for all four operators (catalog, line, stop, trip, geometry, identities and quality).
Set `TRANSIT_TEST_URL` to test a different local URL. This smoke check reports
unavailable sources separately and does not require any vehicles to be active.
