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

El nuevo `TransitRenderer` anima sobre metros acumulados en el shape. El backend entrega un timeline de anclas con llegada y salida, conservando tiempos de espera. `src/transit/motion.ts` convierte tiempo a progreso y progreso a posición/bearing. Para rail/tram utiliza smoothstep entre estaciones; los buses interpolan linealmente. La corrección conserva primero la posición visual anterior y desvanece el error durante 5–20 segundos.

El polling se ejecuta cada 15 s; el bucle de animación usa requestAnimationFrame y actualiza GeoJSON aproximadamente a 15 FPS en desktop y 12 en móvil. El mapa sigue respondiendo a sus propios frames. Los shapes se descargan por lotes y se guardan en memoria; no se proyectan paradas en cada frame. A zoom 17 aparecen cuerpos extruidos simples, limitados a 60 visibles.

El backend infiere un desfase desde GPS para ajustar el timeline y las próximas paradas; solo lo presenta como retraso estimado si está dentro de una hora. Las TripUpdates todavía no se consumen. La extrapolación inicial de Bizkaibus conserva la aproximación de velocidad del core anterior; afinarla con historia de progreso y TripUpdates sigue pendiente. La curva ferroviaria es una aproximación visual, sin modelo físico ni observaciones reales para los operadores estáticos.

No se permite que una posición LIVE conserve esa etiqueta si envejece: el frontend la convierte en PREDICTED después de 45 s. Sin nuevos snapshots durante 180 s retira también cuerpos y selección del mapa. El panel sigue indicando que los servicios SCHEDULED representan un horario, no un GPS.
