# Bilbao Transit 3D

Web app for visualising public transport in Bilbao and Bizkaia in real time.

The current implementation includes Bizkaibus.

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

- MapLibre map.
- 3D buildings where supported by the base style.
- Active Bizkaibus lines.
- Real GTFS route geometry.
- Active stops with names and popups.
- Live vehicles with interpolation.
- Vehicle orientation calculated from the exact shape.
- Top-down shaded bus model aligned with the road/route.
- User-facing line, destination, vehicle and stop information.

## Next steps

Recommended next commits:

```text
feat: improve Bizkaibus direction selection
feat: add Metro Bilbao provider
feat: add Euskotren provider
feat: add operator selector
```
