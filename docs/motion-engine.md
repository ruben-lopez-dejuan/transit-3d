# MotionEngine

El movimiento utiliza distancia acumulada sobre el shape. El backend mantiene
snapping, métricas y planes; el cliente convierte progreso en coordenada/bearing
mediante búsqueda binaria. Los coches ferroviarios calculan su propia tangente.

## Flujo de tiempos

- observationTimestamp: instante original de la fuente GPS, en milisegundos.
- timetableTimestamp: instante original de las predicciones de llegada.
- fetchedAt: consulta/snapshot del servidor, sin renovar los datos originales.
- motionTimestamp: instante de cálculo visual; no es una señal del operador.

El desfase inferido desde GPS se calcula en observationTimestamp, incluso si
su calidad ha envejecido a predicted. Las próximas llegadas se anclan a ese
mismo instante; una consulta duplicada no modifica el desfase ni el estado.

## GPS y correcciones

src/transit/gpsMotion.ts predice sobre metros, a partir del ritmo observado,
próximas paradas y forecasts. Al recibir GPS conserva posición y velocidad;
la observación corrige la predicción progresivamente. No reproduce una cola
antigua ni comprime dos minutos de recorrido en pocos segundos.

src/transit/progressFollower.ts integra un cambio de velocidad con aceleración
limitada, compartido con las transiciones al horario. Correcciones con horizonte
20–90 s dependiente de cadencia; aporte limitado de velocidad, velocidad absoluta
por modo/proveedor y sin retrocesos. Estado STOPPED_AT o velocidad real cero
predominan sobre el horario; predicciones de aproximación anticipan el frenado.
GPS que supera una parada no se rechaza para imponer su horario.

Duplicados HTTP no reinician el predictor. Forecasts nuevos pueden actualizar el
plan sin rejuvenecer GPS. Predicción fuera del último dato es ESTIMADO, progreso
entre lecturas es INTERPOLADO y el progreso observado es REAL. El GPS caduca
tras 180 s; se conserva el fallback disponible y una transición limitada.

## Horario

Calendario/calendar_dates, tiempos superiores a 24 h y fecha del servicio
seleccionan viajes activos. Llegada/salida duplicadas conservan dwell. Rail/tram
usan una curva suave entre estaciones; buses interpolan linealmente y conservan
la pausa estimada existente cuando no hay dwell publicado. No se impone esa
pausa al GPS observado. TripUpdates verificadas tienen prioridad para las ETA.

## Renderizado

Un único requestAnimationFrame prepara movimiento/GeoJSON aproximadamente cada
65 ms (85 ms en pantalla estrecha), sin cambiar el polling de 15 s. Los modelos
son instancias compartidas con siluetas desde zoom 11, partes desde 14 y 16,
y propiedad exclusiva frente a iconos. Las matrices se calculan una vez por
coche en preparación; el render del mapa las reutiliza. Buffers adaptativos y
recursos liberados al retirar el estilo.

Causas, pruebas automatizadas, límites y lista de revisión manual:
[visual-motion.md](visual-motion.md). No se han realizado observaciones visuales
ni medido FPS en el paquete actual.
