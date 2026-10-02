# Evidencias y fuentes — es-malaga

Fecha de investigación y análisis: **2026-10-03**. Zona horaria del paquete: `Europe/Madrid`.

Los hashes y conteos siguientes proceden de los ficheros binarios/ZIP efectivamente aportados y analizados en esta conversación. No son valores inferidos de una página web. El entorno de ejecución del chat no pudo volver a descargar directamente los binarios desde Internet por restricciones de red, por lo que la verificación de contenido se hizo sobre los archivos reales facilitados después de solicitar expresamente los feeds.

## 1. EMT Málaga

- Organismo/productor: Empresa Malagueña de Transportes (EMT Málaga) / Ayuntamiento de Málaga, portal de datos abiertos.
- Página oficial de catálogo: `https://datosabiertos.malaga.eu/dataset/lineas-y-horarios-bus-google-transit`
- URL GTFS declarada: `https://datosabiertos.malaga.eu/recursos/transporte/EMT/lineasYHorarios/google_transit.zip`
- Licencia del recurso: **Creative Commons Attribution 4.0 (CC BY 4.0)** según el portal municipal.
- Archivo analizado: `google_transit.zip`
- Tamaño: **5,316,718 bytes**.
- SHA-256: `1a6a2b7cdd1c6a959b8f714f7778eef108d9cbca22b177b7b90d9d88ec6fcb34`
- Tablas presentes en la raíz: `agency.txt`, `calendar.txt`, `calendar_dates.txt`, `feed_info.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `stop_times.txt`, `trips.txt`.
- `agency_timezone`: `Europe/Madrid`.
- `feed_info`: versión `vers28septiembre2026`; rango declarado **2026-09-28 a 2026-11-30**.
- Conteos: **48 rutas**, **21,618 trips**, **1,127 paradas**, **631,883 stop_times**, **91 shape_id** y **42,882 puntos de shape**.
- Todos los trips contienen referencia a shape; no se detectaron `shape_id` ausentes.
- En la fecha 2026-10-03: **2,656 trips** y **42 rutas** con servicio activo.
- Direcciones: la mayoría de rutas contienen `direction_id` 0 y 1. Algunas rutas especiales/circulares contienen un único `direction_id`; esto se documenta como característica del feed, no se inventa un sentido inexistente.
- Extensión geométrica observada: stops aprox. `[-4.576107, 36.646364]` a `[-4.335772, 36.780030]`; shapes aprox. `[-4.576105, 36.646286]` a `[-4.335835, 36.780345]`.
- Clasificación en Transit 3D: **horario estático / SCHEDULE_SIMULATION**.

### Realtime EMT descartado

El Ayuntamiento publica posiciones de autobuses actualizadas aproximadamente cada minuto en CSV y GeoJSON, por ejemplo `https://datosabiertos.malaga.eu/recursos/transporte/EMT/EMTlineasUbicaciones/lineasyubicaciones.geojson`. Es información de posición real, pero **no es GTFS-RT protobuf**, por lo que API 1 no permite declararla como `vehiclePositions`. No se ha transformado ni simulado como realtime.

## 2. Metro de Málaga

- Organismo/productor: Metro de Málaga, S.A.
- Página oficial: `https://metromalaga.es/`
- URL GTFS declarada: `https://metromalaga.es/GTFS/GTFS_METRO_MALAGA.zip`
- Licencia: condiciones propias de datos abiertos de Metro Málaga; la publicación oficial permite descargar, copiar, almacenar, tratar, adaptar y difundir los datos bajo sus condiciones de uso.
- Archivo analizado: `GTFS_METRO_MALAGA.zip`
- Tamaño: **477,795 bytes**.
- SHA-256: `0e636056608d0cc01f2198dc15fe217231b26155eefcf953ee7689f4429caeee`
- Tablas presentes en la raíz: `agency.txt`, `calendar_dates.txt`, `feed_info.txt`, `pathways.txt`, `routes.txt`, `shapes.txt`, `stop_times.txt`, `stops.txt`, `transfers.txt`, `trips.txt`.
- `agency_timezone`: `Europe/Madrid`.
- `feed_info`: **2026-08-12 a 2026-10-07**; versión `1786531781`.
- Rutas exactas: `1` = L1 y `2` = L2, ambas `route_type=1`.
- Conteos: **2 rutas**, **5,114 trips**, **25 registros de stops** (21 utilizados por `stop_times`), **53,477 stop_times**, **4 shape_id**, **1,435 puntos de shape**.
- Ambos sentidos: L1 y L2 contienen `direction_id` 0 y 1 y dos shapes por línea (`L1V1`, `L1V2`, `L2V1`, `L2V2`).
- En la fecha 2026-10-03: **480 trips**, con L1 y L2 activas.
- No se detectaron referencias a shapes inexistentes y la comprobación geométrica de las cuatro combinaciones línea/sentido fue coherente con la secuencia de paradas.
- Extensión geométrica observada: shapes aprox. `[-4.494234, 36.684534]` a `[-4.423478, 36.719413]`.
- Clasificación en Transit 3D: **horario estático / SCHEDULE_SIMULATION**.
- No se localizó un GTFS-RT protobuf público verificable y compatible para Metro Málaga; no se declara realtime.

**Observación HTTP:** el navegador del usuario pudo descargar este ZIP el 2026-10-03. El crawler web del chat recibió HTTP 403 al intentar abrir directamente el binario, por lo que no se afirma que el endpoint haya sido probado con el cliente HTTP del runtime de Transit 3D.

## 3. Consorcio de Transporte Metropolitano del Área de Málaga / Red CTAN

- Organismo: Red de Consorcios de Transporte de Andalucía; `agency_id` del Área de Málaga: `CTMAM`.
- Portal oficial: `https://api.ctan.es/`
- URL GTFS declarada: `https://api.ctan.es/v1/datos/UNIFICADO/gtfs.zip`
- El portal oficial indica que el GTFS unificado se actualiza diariamente.
- Condiciones de reutilización: reutilización comercial y no comercial autorizada bajo las condiciones del portal y la Ley 37/2007; el portal exige citar la fuente cuando se reutilizan/enlazan los datos. Fuente recomendada por el propio portal: “Información proporcionada por el Portal de Datos Abiertos de la Red de Consorcios de Transporte de Andalucía”.
- Archivo analizado: `gtfs.zip`
- Tamaño: **5,292,373 bytes**.
- SHA-256: `f8f67966d2918403f85204b435333094fc7de0e9694e9c7c39aa840e678239e6`
- Tablas presentes en la raíz: `agency.txt`, `calendar.txt`, `calendar_dates.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `stop_times.txt`, `trips.txt`.
- Feed completo: **486 rutas**, **14,612 trips**, **5,016 paradas**, **291,722 stop_times**, **925 shape_id** y **367,578 puntos de shape**; contiene nueve agencias/consorcios andaluces.
- `agency_timezone` para `CTMAM`: `Europe/Madrid`.

### Filtrado para este paquete

Se ha usado `routeIds` porque el ZIP es multiárea. Primero se restringió a `agency_id=CTMAM`; después se acotó al núcleo metropolitano representado por los bounds `[-4.74, 36.49]` — `[-4.15, 36.88]`, verificando la geometría de los shapes, y se descartaron explícitamente corredores cuyo nombre de ruta declara destinos fuera del alcance (por ejemplo Marbella, Antequera, Casabermeja/Colmenar, Comares, Torre del Mar, Vélez-Málaga, Nerja, Motril, Almería o Córdoba).

`route_id` exactos incluidos (**50**):

`4_1`, `4_3`, `4_4`, `4_5`, `4_7`, `4_8`, `4_9`, `4_10`, `4_11`, `4_12`, `4_13`, `4_14`, `4_15`, `4_16`, `4_17`, `4_18`, `4_19`, `4_20`, `4_89`, `4_90`, `4_93`, `4_109`, `4_110`, `4_122`, `4_123`, `4_130`, `4_133`, `4_140`, `4_208`, `4_214`, `4_215`, `4_216`, `4_217`, `4_219`, `4_226`, `4_227`, `4_230`, `4_231`, `4_234`, `4_238`, `4_239`, `4_242`, `4_254`, `4_276`, `4_279`, `4_296`, `4_297`, `4_301`, `4_302`, `4_308`

Para este subconjunto se observaron **2,251 trips**, **992 paradas utilizadas**, **64,183 stop_times**, **97 shape_id** y **21,461 puntos de shape**. No hay referencias a `shape_id` inexistentes. La extensión de shapes observada queda aprox. entre `[-4.738633, 36.519337]` y `[-4.233674, 36.845925]`.

En 2026-10-03 había **900 trips activos distribuidos en 29 de las 50 rutas seleccionadas**. Las demás incluyen servicios de otros días, servicios universitarios/estacionales o calendarios no activos ese sábado. El GTFS contiene `calendar.txt` y `calendar_dates.txt`; los registros seleccionados incluyen calendarios con horizonte futuro, por lo que la vigencia no se infiere únicamente del rango global del archivo.

La mayoría de las rutas seleccionadas ofrecen `direction_id` 0 y 1. Las rutas `4_234`, `4_254` y `4_301` aparecen con un único sentido/shape en la muestra analizada; se conserva exactamente lo publicado.

Se revisó correspondencia paradas/shapes. En la muestra hay algunas separaciones puntuales de varios cientos de metros y geometrías urbanas con bucles que hacen ambigua una proyección “parada más cercana”; no se detectó inversión sistemática del sentido de los shapes mediante comparación de extremos. Estas imprecisiones son una limitación del feed de origen y no se corrigen desde el paquete.

- Clasificación en Transit 3D: **horario estático / SCHEDULE_SIMULATION**.
- El portal CTAN ofrece además API REST JSON. API 1 no instala adaptadores JSON/SIRI desde una carpeta y no se localizó un GTFS-RT protobuf público compatible para este subconjunto; no se declara realtime.

## 4. Renfe Cercanías — investigado pero excluido de `providers`

### GTFS estático

- Organismo: Renfe.
- Portal oficial: `https://data.renfe.com/dataset/horarios-cercanias`
- URL del recurso: `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip`
- Licencia indicada por Renfe Data: **CC BY 4.0**.
- Archivo analizado: `fomento_transit.zip`
- Tamaño: **13,181,105 bytes**.
- SHA-256: `b7464457aea1acfa052aeff7255040b1b377d582ea1675617cfe7841338ad043`
- Feed nacional completo: **841 rutas**, **104,896 trips**, **1,139 paradas**, **1,486,864 stop_times**, **144 shape_id**, **123,734 puntos de shape**.
- `agency_timezone`: `Europe/Madrid`.
- Núcleo Málaga identificado por los siguientes `route_id` normalizados del feed: `32T0001C1`, `32T0002C1` y `32T0003C2` a `32T0020C2` (20 variantes). En `routes.txt` algunos campos aparecen rellenados con espacios de ancho fijo; en `trips.txt` los IDs correspondientes aparecen sin ese padding.
- Subconjunto Málaga: **3,918 trips**, **23 paradas**, **58,770 stop_times** y cuatro shapes (`32_C1`, `32_C1_INV`, `32_C2`, `32_C2_INV`).
- En 2026-10-03 había **118 trips activos** en seis variantes: `32T0001C1`, `32T0002C1`, `32T0003C2`, `32T0004C2`, `32T0019C2`, `32T0020C2`.
- Calendario observado para los servicios de Málaga de la muestra: **2026-10-01 a 2026-10-30**.

**Motivo de exclusión:** en C1, `32T0001C1` publica la secuencia de paradas Málaga-Centro Alameda → Fuengirola pero referencia `32_C1`, cuyo orden geométrico discurre en sentido contrario. `32T0002C1` presenta el problema equivalente con `32_C1_INV`. La comparación de extremos da aproximadamente **52.2 km** de error si se respeta el orden publicado frente a unos **0.10 km** al invertirlo. El contrato API 1 exige que los shapes sigan el sentido del viaje y no permite corregirlos desde el paquete; por ello Renfe se excluye completo en esta versión en vez de ofrecer un núcleo ferroviario parcialmente inconsistente.

### GTFS-RT Renfe

Fuentes oficiales investigadas:

- VehiclePositions: `https://gtfsrt.renfe.com/vehicle_positions.pb`
- TripUpdates: `https://gtfsrt.renfe.com/trip_updates.pb`

Renfe Data describe `vehicle_positions.pb` como **posición GPS real de Cercanías** y `trip_updates.pb` como actualizaciones de horario/viaje; ambos se anuncian con actualización aproximada cada 20 segundos y licencia CC BY 4.0.

Archivos analizados:

- `vehicle_positions.pb`: **13 bytes**, SHA-256 `bb94559890da016ed1440880219e7b15d8e228cf002cddb944d85b8051c5c076`.
- `trip_updates.pb`: **13 bytes**, SHA-256 `bb94559890da016ed1440880219e7b15d8e228cf002cddb944d85b8051c5c076`.

Ambos protobuf contienen una cabecera GTFS-RT versión `2.0`, timestamp Unix **1790983593**, equivalente a **2026-10-02 23:26:33 UTC / 2026-10-03 01:26:33 Europe/Madrid**, y **cero entidades**. Es una muestra de madrugada; no se interpreta como ausencia de realtime. Al no haber entidades, no se pudo comprobar en esa captura la correspondencia efectiva de `trip_id` con el GTFS estático. No se inventan vehículos ni timestamps y estas URLs no se incluyen en `city.json`.

## Clasificación final de fuentes

| Fuente | Naturaleza observada | Integración API 1 |
|---|---|---|
| EMT GTFS | Horario estático | Incluida |
| EMT posiciones CSV/GeoJSON | Posición real, actualización ~1 min | Excluida: protocolo no soportado |
| Metro Málaga GTFS | Horario estático | Incluida |
| CTAN GTFS | Horario estático | Incluida, filtrada por `routeIds` |
| CTAN API REST | JSON | Excluida: protocolo no soportado |
| Renfe GTFS | Horario estático nacional | Excluida: C1 con shape invertido respecto al viaje |
| Renfe VehiclePositions GTFS-RT | GPS real según fuente oficial | Excluida: muestra vacía + proveedor estático descartado |
| Renfe TripUpdates GTFS-RT | Predicciones/actualizaciones de viaje | Excluida: muestra vacía + proveedor estático descartado |

No se ha afirmado ni realizado una prueba de build, renderizado o ejecución de Transit 3D.
