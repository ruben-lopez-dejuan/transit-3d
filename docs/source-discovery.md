# Descubrimiento y resolución de fuentes

El runtime separa cuatro pasos: `SourceDescriptor` describe una fuente estable;
`SourceResolver` obtiene un recurso descargable; `downloadFile` lo publica de forma
atómica; los providers existentes parsean y normalizan el resultado. Los providers
GTFS y GTFS-RT no conocen NAP.

API 1 sigue aceptando las URLs actuales sin cambios. API 2 permite fuentes HTTP
explícitas y recursos NAP mediante `datasetId` + `fileId`. La identidad de caché usa
el descriptor estable y los filtros de rutas; nunca usa `NAP_API_KEY` ni la URL
firmada temporal.

## Flujo para una ciudad

1. Configura `NAP_API_KEY` solo en el proceso backend.
2. Ejecuta `npm run nap:discover -- --region Madrid` y combina filtros como
   `--operator`, `--mode`, `--format` o `--query`. Añade `--json` para automatizar.
3. Inspecciona un candidato con
   `npm run source:inspect -- --nap 896:1097 --kind gtfs`.
4. Para GTFS-RT usa `--kind gtfs-rt` y revisa el timestamp de cabecera, la edad y
   el tipo real de entidades. Una respuesta HTTP reciente no renueva ese timestamp.
5. Compara vigencia, cobertura, geometría, joins y frescura con la fuente directa.
6. Fija la fuente seleccionada en `city.json`, limita feeds nacionales con
   `routeIds` y ejecuta `npm run cities:check`.

`nap:discover` no decide fuentes en cada arranque. El descubrimiento es una tarea
de integración; el runtime solo resuelve descriptores ya seleccionados. Para añadir
otro catálogo se implementa `SourceResolver` y se conserva el contrato
`ResolvedSource`. SIRI y NeTEx se descubren y documentan, pero todavía no tienen un
adaptador genérico de runtime.

## Movimiento realtime

`GpsMotion` mantiene separadas la última observación, la referencia prevista y la
posición renderizada. `progressFollower` convierte el error hacia delante en una
velocidad de corrección continua. Usa error, cadencia, ritmo previsto, aceleración,
límite de velocidad y frenado por parada. Un error pequeño conserva suavidad; uno
grande contra GPS fresco usa más margen físico. La corrección no supera el límite
del modo, no rebasa la referencia y nunca mueve el vehículo hacia atrás.
