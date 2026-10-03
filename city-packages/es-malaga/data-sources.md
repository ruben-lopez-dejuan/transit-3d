# Evidencias y fuentes — es-malaga

Fecha de análisis: **2026-10-03**. Zona horaria: `Europe/Madrid`.

Los tamaños, hashes, conteos, IDs y timestamps indicados a continuación proceden de los archivos binarios/ZIP realmente aportados y analizados. No se inventan vehículos, timestamps ni resultados de descarga.

## 1. EMT Málaga

- Organismo/productor: Empresa Malagueña de Transportes (EMT Málaga) / Ayuntamiento de Málaga.
- Catálogo oficial: `https://datosabiertos.malaga.eu/dataset/lineas-y-horarios-bus-google-transit`
- GTFS directo: `https://datosabiertos.malaga.eu/recursos/transporte/EMT/lineasYHorarios/google_transit.zip`
- Licencia: **CC BY 4.0** según el portal municipal.
- Archivo analizado: `google_transit.zip`
- Tamaño: **5,316,718 bytes**
- SHA-256: `1a6a2b7cdd1c6a959b8f714f7778eef108d9cbca22b177b7b90d9d88ec6fcb34`
- Tablas en raíz: `agency.txt`, `calendar.txt`, `calendar_dates.txt`, `feed_info.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `stop_times.txt`, `trips.txt`
- `agency_timezone`: `Europe/Madrid`
- `feed_info`: versión `vers28septiembre2026`, rango 2026-09-28 — 2026-11-30
- Conteos: **48 rutas**, **21,618 trips**, **1,127 stops**, **631,883 stop_times**, **91 shape_id**, **42,882 puntos de shape**
- En 2026-10-03: **2,656 trips** y **42 rutas** con servicio activo.
- Todos los trips de la muestra referencian shapes existentes.
- Clasificación: **horario estático / SCHEDULE_SIMULATION**.

### Realtime EMT descartado

El Ayuntamiento publica posiciones de vehículos en CSV/GeoJSON con actualización frecuente. Es información de posición real, pero API 1 solo admite GTFS-RT protobuf para `vehiclePositions`; no se declara como realtime ni se transforma desde este paquete.

## 2. Metro de Málaga

- Organismo/productor: Metro de Málaga, S.A.
- Web oficial: `https://metromalaga.es/`
- GTFS directo: `https://metromalaga.es/GTFS/GTFS_METRO_MALAGA.zip`
- Licencia: condiciones propias de datos abiertos de Metro Málaga; permiten uso, copia, almacenamiento, tratamiento, adaptación y difusión bajo sus condiciones.
- Archivo analizado: `GTFS_METRO_MALAGA.zip`
- Tamaño: **477,795 bytes**
- SHA-256: `0e636056608d0cc01f2198dc15fe217231b26155eefcf953ee7689f4429caeee`
- Tablas en raíz: `agency.txt`, `calendar_dates.txt`, `feed_info.txt`, `pathways.txt`, `routes.txt`, `shapes.txt`, `stop_times.txt`, `stops.txt`, `transfers.txt`, `trips.txt`
- `agency_timezone`: `Europe/Madrid`
- `feed_start_date`: `20260812`
- `feed_end_date`: `20261007`
- `feed_version`: `1786531781`
- Rutas: `1` = L1 y `2` = L2, `route_type=1`
- Conteos: **2 rutas**, **5,114 trips**, **25 stops**, **53,477 stop_times**, **4 shape_id**, **1,435 puntos de shape**
- Ambos sentidos presentes:
  - L1: `L1V1`, `L1V2`
  - L2: `L2V1`, `L2V2`
- En 2026-10-03: **480 trips activos** — 241 en L1 y 239 en L2.
- La geometría de los cuatro sentidos es coherente con la secuencia de paradas.
- Clasificación: **horario estático / SCHEDULE_SIMULATION**.
- No se ha verificado un GTFS-RT protobuf público compatible; no se declara realtime.

## 3. Consorcio de Transporte Metropolitano del Área de Málaga / CTAN

- Organismo: Red de Consorcios de Transporte de Andalucía.
- Agencia del Área de Málaga en el GTFS: `CTMAM`
- Portal oficial: `https://api.ctan.es/`
- GTFS directo: `https://api.ctan.es/v1/datos/UNIFICADO/gtfs.zip`
- El portal oficial indica actualización diaria.
- Reutilización comercial y no comercial permitida conforme al aviso legal del portal; debe citarse la fuente.
- Archivo analizado: `gtfs.zip`
- Tamaño: **5,292,373 bytes**
- SHA-256: `f8f67966d2918403f85204b435333094fc7de0e9694e9c7c39aa840e678239e6`
- Tablas en raíz: `agency.txt`, `calendar.txt`, `calendar_dates.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `stop_times.txt`, `trips.txt`
- Feed completo: **486 rutas**, **14,612 trips**, **5,016 stops**, **291,722 stop_times**, **925 shape_id**, **367,578 puntos de shape**
- `agency_timezone` para `CTMAM`: `Europe/Madrid`

### `routeIds` seleccionados

El ZIP contiene nueve consorcios andaluces, por lo que el paquete usa `routeIds` exactos para no importar otras ciudades. Todos los IDs siguientes existen en la muestra y pertenecen a `agency_id=CTMAM`:

`4_1`, `4_3`, `4_4`, `4_5`, `4_7`, `4_8`, `4_9`, `4_10`, `4_11`, `4_12`, `4_13`, `4_14`, `4_15`, `4_16`, `4_17`, `4_18`, `4_19`, `4_20`, `4_89`, `4_90`, `4_93`, `4_109`, `4_110`, `4_122`, `4_123`, `4_130`, `4_133`, `4_140`, `4_208`, `4_214`, `4_215`, `4_216`, `4_217`, `4_219`, `4_226`, `4_227`, `4_230`, `4_231`, `4_234`, `4_238`, `4_239`, `4_242`, `4_254`, `4_276`, `4_279`, `4_296`, `4_297`, `4_301`, `4_302`, `4_308`

Subconjunto seleccionado en la muestra anterior del mismo feed aportado:

- **50 rutas**
- **2,251 trips**
- **992 stops utilizados**
- **64,183 stop_times**
- **97 shape_id**
- **21,461 puntos de shape**
- En 2026-10-03: **900 trips activos** distribuidos en 29 de las 50 rutas.

Cobertura elegida: Málaga y su continuo metropolitano dentro de los bounds del paquete, excluyendo corredores claramente externos al alcance seleccionado.

Clasificación: **horario estático / SCHEDULE_SIMULATION**.

La API REST JSON de CTAN no se declara como realtime porque API 1 no instala adaptadores JSON/SIRI desde una carpeta.

## 4. Renfe Cercanías Málaga

### 4.1 GTFS estático nacional

- Organismo: Renfe.
- Catálogo oficial: `https://data.renfe.com/dataset/horarios-cercanias`
- GTFS directo: `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip`
- Licencia: **CC BY 4.0**
- Archivo analizado: `fomento_transit.zip`
- Tamaño: **14,056,338 bytes**
- SHA-256: `72355fad13b80eb94d8007a432ebe59286ba2324a0d646072154e8a63c2505fe`
- Tablas en raíz: `agency.txt`, `calendar.txt`, `routes.txt`, `shapes.txt`, `stops.txt`, `stop_times.txt`, `transfers.txt`, `trips.txt`
- `agency_timezone`: `Europe/Madrid`
- Feed nacional completo:
  - **843 rutas**
  - **114,348 trips**
  - **1,139 stops**
  - **1,598,691 stop_times**
  - **144 shape_id**
  - **123,734 puntos de shape**
- Horizonte global de `calendar.txt`: **2026-09-24 — 2026-10-23**

### 4.2 Rutas de Málaga observadas

Los `route_id` con trips reales para el núcleo 32 en esta versión son:

- `32T0001C1` — C1 Málaga-Centro Alameda → Fuengirola
- `32T0002C1` — C1 Fuengirola → Málaga-Centro Alameda
- `32T0003C2` — C2 Málaga-Centro Alameda → Álora
- `32T0004C2` — C2 Álora → Málaga-Centro Alameda
- `32T0019C2` — variante incompleta con un único stop_time en la muestra
- `32T0020C2` — variante sin stop_times en la muestra analizada

El paquete **solo selecciona `32T0003C2` y `32T0004C2`**, ya que son las dos rutas completas de C2 y ambas pasan la comprobación geométrica.

C2 seleccionado:

- **732 trips**
- **6,588 stop_times**
- **9 stops**
- Shapes: `32_C2` y `32_C2_INV`
- **708 puntos de shape**
- En 2026-10-03: **16 trips activos** — 8 por sentido.
- Color publicado en el GTFS para C2: `#0FCF34`.

Comprobación de orientación:

- `32T0003C2` Málaga → Álora:
  - inicio del shape a ~66 m de Málaga-Centro Alameda;
  - final del shape a ~18 m de Álora.
- `32T0004C2` Álora → Málaga:
  - inicio del shape a ~18 m de Álora;
  - final del shape a ~66 m de Málaga-Centro Alameda.

Resultado: **C2 es coherente y se incluye**.

### 4.3 C1 descartada por geometría invertida

C1 sigue presentando un defecto sistemático en el GTFS oficial actual:

- `32T0001C1` declara Málaga-Centro Alameda → Fuengirola pero usa `32_C1`.
  - La primera parada está a ~26.2 km del inicio del shape y a ~66 m de su final.
  - La última parada, Fuengirola, está a ~35 m del inicio del shape.
- `32T0002C1` declara Fuengirola → Málaga-Centro Alameda pero usa `32_C1_INV`.
  - La primera parada está a ~26.1 km del inicio del shape y a ~35 m de su final.
  - La última parada está a ~66 m del inicio del shape.

Los shapes están, por tanto, asociados en el sentido contrario al viaje. API 1 exige shapes coherentes y no permite invertirlos mediante configuración. **C1 queda fuera del `city.json` hasta que Renfe corrija el feed o exista una fuente pública oficial compatible que no tenga este defecto.**

### 4.4 GTFS-RT descargado en horario diurno

Fuentes oficiales:

- VehiclePositions: `https://gtfsrt.renfe.com/vehicle_positions.pb`
- TripUpdates: `https://gtfsrt.renfe.com/trip_updates.pb`

La documentación de Renfe describe VehiclePositions como posición **GPS real** de Cercanías y TripUpdates como actualizaciones de viaje; anuncia actualización aproximada cada 20 segundos.

#### VehiclePositions

- Archivo: `vehicle_positions.pb`
- Tamaño: **13 bytes**
- SHA-256: `4591fbe8e6896606b3370b5d3eb7d0d61317b3d705c8e34a90931613f940d9c7`
- GTFS-RT: `2.0`
- Timestamp de cabecera: Unix `1791019075`
- UTC: **2026-10-03 09:17:55**
- Europe/Madrid: **2026-10-03 11:17:55 CEST**
- Entidades: **0**

Aunque la fuente está documentada como GPS real, esta captura diurna no contiene posiciones. No se inventan vehículos ni se declara `vehiclePositions`.

#### TripUpdates

- Archivo: `trip_updates.pb`
- Tamaño: **191 bytes**
- SHA-256: `246061ce44d819d6a1ba9ace210403e4a41528565c88a30ae08d7058a58ae9ce`
- GTFS-RT: `2.0`
- Timestamp de cabecera: Unix `1791019075`
- UTC: **2026-10-03 09:17:55**
- Europe/Madrid: **2026-10-03 11:17:55 CEST**
- Entidades: **2**

Entidades observadas:

1. `TUCANCEL_SPECIAL_20_92021`
   - `trip_id=SPECIAL_20_92021`
   - `schedule_relationship=CANCELED`
   - no corresponde a un `trip_id` del GTFS estático aportado.

2. `TUADDED_SPECIAL_10_91671C7`
   - `trip_id=SPECIAL_10_91671C7`
   - `schedule_relationship=ADDED`
   - `route_id=10T0053C7`
   - esa ruta es C7 Príncipe Pío–Atocha, no Málaga.
   - incluye dos actualizaciones de parada, con tiempos 11:17 y 11:27 CEST aproximadamente.

No hay TripUpdates de `32T0003C2`, `32T0004C2` ni de C1 en la captura. Por ello no puede verificarse correspondencia realtime/GTFS para Málaga y **no se declara `tripUpdates`**.

## 5. Clasificación final

| Proveedor/fuente | Naturaleza | Estado API 1 |
|---|---|---|
| EMT GTFS | Horario estático | Incluido |
| EMT posiciones CSV/GeoJSON | GPS/posición real | Excluido: protocolo no soportado |
| Metro Málaga GTFS | Horario estático | Incluido |
| CTAN GTFS | Horario estático | Incluido y filtrado por `routeIds` |
| CTAN REST JSON | API JSON | Excluido: protocolo no soportado |
| Renfe C2 GTFS | Horario estático | **Incluido**, IDs `32T0003C2` y `32T0004C2` |
| Renfe C1 GTFS | Horario estático | Excluido: shapes invertidos |
| Renfe VehiclePositions | GPS real según Renfe | Excluido: muestra diurna con 0 entidades |
| Renfe TripUpdates | Predicciones/actualizaciones | Excluido: no hubo entidades de Málaga |

## 6. Limitaciones

- La integración de Cercanías es **parcial**: C2 sí; C1 todavía no.
- Ninguna URL realtime se declara hasta verificar datos útiles y compatibles para las rutas malagueñas.
- Metro Málaga tiene horizonte publicado hasta el 07/10/2026 en la muestra actual.
- Los feeds remotos pueden cambiar después de esta fecha; `cities:check` valida configuración, no certifica la disponibilidad futura de los feeds.
- No se ha probado el renderizado ni la ejecución de Transit 3D.
