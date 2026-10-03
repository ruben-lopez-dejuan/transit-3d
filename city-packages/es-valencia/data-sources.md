# Fuentes de datos — es-valencia

Fecha de investigación: 2026-10-03  
Estado global: **pendiente de validación binaria final**

## Criterio de verificación usado

El contrato exige descargar y analizar realmente los ZIP/protobuf antes de declarar
una fuente “verificada”. En esta sesión se pudieron consultar metadatos oficiales,
catálogos actuales, páginas de recursos y las representaciones JSON públicas del
GTFS-RT de Renfe, pero no se pudieron guardar localmente los binarios GTFS/GTFS-RT.
Por eso los SHA-256 y los conteos derivados de una descarga propia figuran como
pendientes.

Los tamaños/conteos citados como “NAP” son **metadatos del catálogo NAP aportado
para esta investigación**, no mediciones realizadas sobre un archivo descargado.

---

## 1. EMT València

**Organismo:** EMT València / Ajuntament de València  
**Protocolo seleccionado:** GTFS estático  
**Transit 3D:** API 2, NAP  
**Descriptor:** `datasetId=965`, `fileId=1166`

### Evidencia de catálogo NAP

- Nombre: Autobús urbano de Valencia
- Formato: GTFS-ZIP
- `valid=true`
- Actualización indicada: 2026-10-02T21:20:18Z
- Vigencia indicada: 2026-09-25 → 2026-11-01
- Metadatos NAP: 50 rutas, 35 984 trips, 1 155 paradas
- Tamaño indicado por NAP: 7 415 933 bytes

### Fuente oficial

Portal de datos abiertos del Ajuntament de València, conjunto de datos Google
Transit / EMT València. La ficha pública indica licencia Creative Commons
Attribution 4.0.

### Clasificación de movimiento

- GTFS estático: **horario / SCHEDULE_SIMULATION**
- VehiclePositions GTFS-RT: **no configurado**
- TripUpdates GTFS-RT: **no configurado**

### Validación pendiente

- Descarga binaria del ZIP: pendiente
- SHA-256: pendiente
- Tablas raíz y shapes: pendiente de inspección directa
- Calendar/calendar_dates: pendiente de inspección directa
- Ambos sentidos y coherencia shape-stop: pendiente de inspección directa
- Zona horaria dentro del ZIP: pendiente de inspección directa

---

## 2. Metrovalencia (FGV)

**Organismo:** Ferrocarrils de la Generalitat Valenciana (FGV)  
**Protocolo seleccionado:** GTFS estático  
**Transit 3D:** API 2, NAP  
**Descriptor:** `datasetId=967`, `fileId=1168`

### Evidencia de catálogo NAP

- Nombre: Metro de Valencia
- Publicador: FGV - Generalitat Valenciana
- Formato: GTFS-ZIP
- `valid=true`
- Actualización indicada: 2026-10-02T11:20:06Z
- Vigencia indicada: 2026-09-05 → 2026-12-27
- Metadatos NAP: 113 rutas, 8 744 trips, 144 paradas
- Tamaño indicado por NAP: 904 584 bytes

La cifra de 113 `routes` es el número de registros GTFS del recurso, no debe
interpretarse como 113 líneas comerciales.

### Clasificación de movimiento

- GTFS estático: **horario / SCHEDULE_SIMULATION**
- VehiclePositions GTFS-RT: **no configurado**
- TripUpdates GTFS-RT: **no configurado**

No se ha encontrado y validado en esta auditoría un protobuf GTFS-RT público de
FGV compatible con el contrato. Cualquier realtime ofrecido mediante otro
protocolo/API queda **pendiente**, no se adapta desde esta carpeta.

### Validación pendiente

- Descarga binaria del ZIP: pendiente
- SHA-256: pendiente
- `routes/trips/stops/stop_times/shapes`: pendiente de inspección directa
- Calendar/calendar_dates: pendiente
- Ambos sentidos y shapes: pendiente
- Identificación exacta de route_type metro/tranvía dentro del GTFS: pendiente
- Zona horaria interna: pendiente

---

## 3. Cercanías València (Renfe)

**Organismo:** Renfe  
**GTFS estático:** NAP API 2  
**Descriptor estático:** `datasetId=929`, `fileId=1130`  
**TripUpdates:** `https://gtfsrt.renfe.com/trip_updates.pb`  
**VehiclePositions:** `https://gtfsrt.renfe.com/vehicle_positions.pb`  
**Licencia de los conjuntos realtime oficiales:** Creative Commons Attribution 4.0

### GTFS estático — evidencia NAP

El recurso NAP suministrado para el feed nacional indicaba:

- Formato GTFS-ZIP, `valid=true`
- Actualización: 2026-10-03T19:21:09Z
- Vigencia NAP: 2026-09-24 → 2026-10-23
- 843 rutas, 114 348 trips, 1 139 paradas
- 14 056 338 bytes

Al ser nacional, **no se consume sin filtro**.

### `routeIds` seleccionados para València

- C1: `40T0001C1`, `40T0002C1`
- C2 ferroviario: `40T0005C2`, `40T0006C2`
- C2 sustitución actual por autobús: `40T0049C2`, `40T0053C2`
- C3: `40T0025C3`, `40T0026C3`, `40T0043C3`, `40T0044C3`
- C5 sustitución actual por autobús: `40T0057C5`, `40T0063C5`
- C6 principal València–Castelló: `40T0013C6`, `40T0014C6`

Se excluyen `40T0015C6`/`40T0016C6` porque corresponden al tramo
Castelló–Vinaròs y ampliarían el paquete más allá del núcleo solicitado.

### GTFS-RT oficial observado

Renfe Data publica:

- “Ubicación de los vehículos”: posición **GPS** y estado; actualización declarada
  cada 20 s.
- “Horarios de viaje”: cambios/cancelaciones/retrasos por viaje; actualización
  declarada cada 20 s.

Durante la consulta del 2026-10-03, la representación JSON oficial de
VehiclePositions mostraba:

- `gtfsRealtimeVersion = 2.0`
- header timestamp observado: `1791053625`
  = 2026-10-03 18:53:45 UTC / 20:53:45 Europe/Madrid
- timestamps de entidades observadas: `1791053624`
- entidades del núcleo de València con `tripId` como:
  `4074S31444C3`, `4074S24262C1`, `4074S30449C6`

La representación JSON oficial de TripUpdates mostraba:

- `gtfsRealtimeVersion = 2.0`
- header timestamp observado: `1791059728`
- ejemplos de València:
  `4074S24281C1`, `4074S31450C3`, `4074S24097C2`,
  `4074S24362C6`
- `scheduleRelationship = SCHEDULED`
- delays y tiempos de llegada por `stopId`

Esto prueba que los endpoints oficiales estaban activos y que el núcleo 40 tenía
contenido realtime útil. **No sustituye** la comparación binaria contra el
`trips.txt` exacto descargado, que sigue pendiente.

### Clasificación

- `vehiclePositions`: **GPS real**
- `tripUpdates`: **predicción/actualización operacional**, no GPS
- GTFS estático: **horario / fallback SCHEDULE_SIMULATION**

### Recurso NAP realtime descartado

El volcado NAP aportado listaba varios ficheros `GTFS RT` del dataset 929 con
`valid=false`, cero bytes y cero entidades. No se usan. Para realtime se han
seleccionado los endpoints públicos directos de Renfe Data.

### Validación pendiente

- Descargar `fileId=1130` y calcular SHA-256
- Descargar ambos `.pb` y calcular SHA-256/tamaño
- Verificar protobuf directamente, no solo JSON equivalente
- Confirmar todos los route_id seleccionados en el `routes.txt` exacto
- Confirmar que muestras de `tripId` GTFS-RT existen exactamente en `trips.txt`
- Revisar shapes, directions y servicio activo de cada variante
- Revisar tratamiento de rutas de sustitución por autobús

---

## 4. Autobús interurbano de la Comunitat Valenciana — descartado para este paquete

**NAP:** dataset 1325, fileId 1526  
**Publicador:** Generalitat Valenciana

El catálogo NAP aportado lo presenta como GTFS vigente y regional. Sin embargo,
la ficha pública de datos abiertos de la Generalitat indica expresamente que el
conjunto **no incluye las concesiones de la Autoritat de Transport Metropolità de
València**.

Por ese motivo no se usa como sustituto de MetroBus ni se añade a `providers`.
Incluirlo sin filtrado introduciría servicios regionales ajenos al núcleo pedido.

**Estado MetroBus/ATMV:** pendiente de una fuente GTFS/GTFS-RT compatible y
verificada específicamente para el área metropolitana.

---

## 5. Fuentes/capacidades no incluidas

- SIRI: no soportado por el paquete de carpetas.
- NeTEx: no soportado por el paquete de carpetas.
- APIs JSON municipales/propietarias: no se declaran como realtime.
- ServiceAlerts: fuera de las capacidades públicas de este formato.
- URLs firmadas temporales y API keys: no incluidas.

---

## Resultado de la auditoría

El `city.json` es **válido como configuración candidata**, pero la auditoría
obligatoria de contenido binario permanece abierta. No debe etiquetarse como
“feed verificado” hasta completar los hashes, tablas, calendarios, shapes,
direcciones y cruces exactos de IDs descritos arriba.
