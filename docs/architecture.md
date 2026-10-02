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

El adaptador `BizkaibusProvider` conserva los descargadores, cache, parser protobuf y map matching que ya existían. Los endpoints legados `/api/routes`, `/api/routes/:routeId/active` y `/api/vehicles` siguen disponibles por compatibilidad. El nuevo frontend consume el snapshot común enriquecido de `/api/transit`.

La instancia de `TransitEngine` registra Bizkaibus y tres instancias de `StaticGtfsProvider` para Bilbobus, Metro Bilbao y Euskotren. Las cuatro fuentes están descargadas, parseadas y presentes en la interfaz. Los tres adaptadores estáticos generan posiciones SCHEDULED; sus fuentes realtime aún no están conectadas.

## Calendario y viajes activos

El loader de Bizkaibus lee `calendar.txt` y `calendar_dates.txt`. Las excepciones `1` (servicio añadido) y `2` (servicio eliminado) prevalecen sobre el calendario semanal. El día de servicio usa la zona `Europe/Madrid`; se reconocen horarios GTFS de hasta 99 horas y servicios que continúan pasada la medianoche.

El generador de posición schedule proyecta paradas ordenadas sobre el shape del viaje y obtiene el progreso actual interpolando los tiempos GTFS entre anclas. No inventa observaciones GPS. Los vehículos scheduled y realtime con el mismo trip usan una identidad lógica compartida en el snapshot.

## Evolución prevista

La siguiente fase puede incorporar TripUpdates y nuevos adaptadores sin cambiar el modelo ni el mapa. Debe verificar feed y correspondencia de trip antes de elevar calidad a LIVE/PREDICTED; la disponibilidad de una URL por sí sola no basta.

## API común y frontend

- `GET /api/network`: operadores, líneas, sentidos, paradas y lugares de la red.
- `GET /api/transit`: vehículos, calidad, frescura y estado por operador.
- `POST /api/geometries`: shapes y metros acumulados para hasta 100 claves.
- `GET /api/lines/:operatorId/:routeId?direction=all`: recorridos, paradas y salidas desde cabecera.
- `GET /api/stops/:operatorId/:stopId`: próximas salidas y paradas cercanas (80 m).
- `GET /api/trips/:operatorId/:tripId?date=YYYYMMDD`: shape exacto y paradas del servicio seleccionado.

`server/transit/network.ts` une catálogo y snapshots, indexa referencias por parada y conserva IDs propios de cada operador. Los caches de métricas/planes usan la identidad del feed para evitar colisiones de shape/trip entre operadores. Los shapes se simplifican manteniendo sus distancias acumuladas originales.

`src/app.ts` coordina selección, búsqueda, filtros, polling y cámara. `src/map/networkMap.ts` instala capas; `TransitRenderer` mantiene el estado de movimiento y corrección independiente del polling. El navegador solo pide datos de transporte a `/api/*`; la cartografía y tipografía son recursos públicos externos.

Los pedidos de detalles tienen una versión para descartar respuestas de selecciones anteriores. La interfaz mantiene información previa ante fallos, informa de frescura y retira posiciones tras 180 s sin snapshot. Las API llevan `Cache-Control: no-store` y el service worker excluye `/api/*`.

La PWA se genera con Vite, sin añadir un segundo frontend. Express sirve `dist` junto con la API. El wrapper Android/Capacitor sigue pendiente.
