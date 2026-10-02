# MotionEngine

El movimiento se representa como distancia acumulada sobre el shape. Las utilidades reutilizables están en `server/transit/motionEngine.ts`.

## Primitivas

- `buildShapeMetric`: crea coordenadas y distancias acumuladas en metros.
- `projectOntoShape`: proyecta una coordenada a un segmento compatible y devuelve progreso, distancia y rumbo.
- `positionAtProgress`: convierte progreso a coordenada y bearing sin abandonar el shape.
- `interpolateProgress`: interpola en el eje de distancia usando una curva suave.
- `correctedProgress`: aproxima progresivamente un progreso observado, con duración de corrección configurable (10 s por defecto).

La generación schedule usa paradas GTFS como anclas y calcula una posición dentro del segmento temporal actual. Los viajes que cruzan medianoche aprovechan tiempos GTFS superiores a 24:00.

## Estados de posición

- `live`: posición VehiclePosition reciente, ajustada al shape exacto.
- `predicted`: posición procedente de una extrapolación o de tiempos/retrasos realtime verificables.
- `scheduled`: posición calculada solo a partir de calendario y horario GTFS.

La observación GPS original conserva su timestamp. La calidad pasa a predicted cuando la posición deja de ser reciente; tras 3 minutos se descarta como ubicación y se deja el fallback schedule cuando esté disponible.

## Límites de esta fase

Las primitivas de interpolación/corrección están implementadas y cubiertas por tests, pero aún no controlan el bucle de animación del mapa: el renderer actual conserva su interpolación entre snapshots. Los feeds TripUpdates de Metro/Euskotren todavía no se consumen; no se presenta su contenido como posición prevista. La predicción continua, el retraso propagado y la curva ferroviaria con paradas forman parte de las siguientes iteraciones del motor.
