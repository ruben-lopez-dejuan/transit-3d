# Arquitectura del core

## Flujo

```text
GTFS / GTFS-RT
      ↓
Proveedor de operador (backend)
      ↓ normalización
TransitVehicle + ProviderSnapshot
      ↓
TransitEngine → /api/transit
      ↓
Frontend / renderer
```

El backend es el único componente que descarga los feeds. Cada adaptador implementa `TransitProvider`; `TransitEngine` recoge snapshots, mantiene el estado individual de cada fuente y combina vehículos por identidad lógica. Un error de un provider se refleja como `unavailable` y no impide combinar el resto.

## Modelo común

`server/transit/types.ts` define `TransitVehicle` con operador, modo, trip, ruta, shape, `progressMetersAlongShape`, posición, rumbo, calidad de posición y timestamps. `positionQuality` tiene tres estados: `live`, `predicted` y `scheduled`.

El adaptador `BizkaibusProvider` conserva los descargadores, cache, parser protobuf y map matching que ya existían. Los endpoints legados `/api/routes`, `/api/routes/:routeId/active` y `/api/vehicles` siguen atendiendo al frontend actual. `/api/transit` expone el snapshot normalizado del nuevo core.

La instancia de `TransitEngine` registra Bizkaibus por ahora. Bilbobus, Metro Bilbao y Euskotren tienen fuentes GTFS comprobadas y quedan listos para adaptadores de las próximas fases; todavía no aparecen en la interfaz ni el engine.

## Calendario y viajes activos

El loader de Bizkaibus lee `calendar.txt` y `calendar_dates.txt`. Las excepciones `1` (servicio añadido) y `2` (servicio eliminado) prevalecen sobre el calendario semanal. El día de servicio usa la zona `Europe/Madrid`; se reconocen horarios GTFS de hasta 99 horas y servicios que continúan pasada la medianoche.

El generador de posición schedule proyecta paradas ordenadas sobre el shape del viaje y obtiene el progreso actual interpolando los tiempos GTFS entre anclas. No inventa observaciones GPS. Los vehículos scheduled y realtime con el mismo trip usan una identidad lógica compartida en el snapshot.

## Evolución prevista

La siguiente fase puede registrar adaptadores estáticos/realtime adicionales sin cambiar el modelo ni el mapa. Debe verificar feed y correspondencia de trip antes de elevar calidad a LIVE/PREDICTED; la disponibilidad de una URL por sí sola no basta. El frontend aún usa respuestas históricas específicas de Bizkaibus y deberá migrarse a `/api/transit` por separado.
