# Fuentes de datos — Pamplona y Navarra

Fecha de investigación: **2026-10-03**.

## 1. Transporte Urbano Comarcal (TUC / TCC Pamplona)

**Organismo / operador:** Mancomunidad de la Comarca de Pamplona / Moventis TCC. Publicador NAP: Infotuc.  
**Página oficial actual:** https://www.tuvillavesa.es/  
**NAP:** dataset `976`, fichero `1177`, formato `GTFS-ZIP`.  
**Fuente configurada en `city.json`:** `{ "type": "nap", "datasetId": 976, "fileId": 1177 }`.

### Metadatos actuales observados en NAP

- Recurso marcado como válido y no obsoleto.
- Actualizado: `2026-10-03T01:29:04.158448Z`.
- Ventana declarada por NAP: `2026-10-03T00:00:00Z` → `2026-10-07T00:00:00Z`.
- 54 rutas, 13.603 trips y 567 paradas según el descubrimiento NAP aportado para esta sesión.
- Tamaño declarado: 3.411.370 bytes.

### Comprobaciones y limitaciones

- La web oficial enumera líneas diurnas, nocturnas y especiales y ofrece mapa/tiempos en tiempo real.
- Un archivo histórico del mismo endpoint NAP, importado por Transitland el 29-09-2026, contenía `routes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`, `shapes.txt` y `calendar_dates.txt`; esto confirma que el feed ha incluido shapes recientemente, pero **no sustituye la inspección del ZIP actual**.
- El endpoint NAP requiere `ApiKey`; el entorno de esta sesión no pudo recuperar el ZIP actual. Por tanto no hay SHA-256 local ni validación binaria de shapes, ambos sentidos, calendarios o IDs del fichero actual.
- No se encontró GTFS-RT público documentado para TUC. La información en tiempo real de Tu Villavesa procede de su plataforma web/app; queda **pendiente** hasta disponer de un protocolo soportado.
- Clasificación Transit 3D actual: **horario estático / SCHEDULE_SIMULATION**. No GPS real, no predicción GTFS-RT.

## 2. NBus — Transporte Interurbano de Navarra

**Organismo:** Gobierno de Navarra, Departamento de Cohesión Territorial.  
**Dataset oficial de Datos Abiertos de Navarra:** Transporte público interurbano regular de viajeros en autobús.  
**Distribución GTFS pública:** https://datosabiertos.navarra.es/dataset/ebfb5edd-0cd9-4b31-b0d9-8bc2d25e2493/resource/d3c1c89a-5d4c-4c25-97b5-66da663d3691/download/gtfs.zip  
**Licencia publicada:** CC BY 4.0.  
**NAP:** dataset `963`, fichero `1164`, formato `GTFS-ZIP`.  
**Fuente configurada en `city.json`:** `{ "type": "nap", "datasetId": 963, "fileId": 1164 }`.

### Metadatos actuales observados en NAP

- Recurso marcado como válido y no obsoleto.
- Actualizado: `2026-09-23T11:26:37.024323Z`.
- Ventana declarada por NAP: `2026-04-10T00:00:00Z` → `2026-12-31T00:00:00Z`.
- 30 rutas, 475 trips y 226 paradas.
- Tamaño declarado: 6.112.733 bytes.
- Operadores declarados: Conda S.A., La Burundesa S.A.U. e Inter-Arriaga S.L.

### Cobertura y limitaciones

El dataset del Gobierno de Navarra describe servicios interurbanos autorizados por la Comunidad Foral e indica que algunas concesiones sobrepasan sus límites cuando la mayor parte del recorrido discurre por Navarra. Por eso el feed puede contener extensiones a Vitoria-Gasteiz, Soria o Zaragoza: no son feeds de esas ciudades, sino extremos de concesiones navarras.

El catálogo oficial indica que el GTFS contiene concesiones, operadores, líneas, itinerarios, paradas, calendarios y horarios. El entorno de esta sesión pudo acceder a la ficha y al endpoint, pero no recuperar el ZIP binario; por ello quedan pendientes el SHA-256 local, la zona horaria leída directamente de `agency.txt`, shapes, ambos sentidos y correspondencia stop-shape del fichero vigente.

No se encontró un GTFS-RT público verificable para este dataset. Clasificación Transit 3D actual: **horario estático / SCHEDULE_SIMULATION**.

## 3. Fuentes investigadas pero no integradas

### RENFE Cercanías — NAP dataset 929

Feed nacional. El descubrimiento NAP aportado incluye cobertura de Navarra y recursos GTFS/GTFS-RT nacionales, pero Pamplona no se integra aquí como un núcleo de Cercanías independiente. Además, sin descargar el GTFS actual no se pueden obtener `route_id` exactos de interés sin riesgo de arrastrar otras redes. **Descartado del paquete.**

### RENFE Media, Larga Distancia y AVE — NAP dataset 897

Es relevante para Pamplona, Tafalla, Castejón y Tudela, pero es un feed nacional. Para incluirlo el contrato exige seleccionar `routeIds` exactos del ámbito. No se pudo descargar el GTFS actual durante esta sesión, por lo que no se han inferido IDs. **Pendiente.**

### ALSA — NAP dataset 932, fichero GTFS 1133

Feed nacional con cobertura en Navarra/Pamplona. No se incluye porque no se pudo inspeccionar el GTFS actual ni aislar `route_id` exactos de Navarra. Además, parte de la oferta puede solaparse con concesiones NBus. **Pendiente.**

### Alavabus — NAP dataset 1161

Tiene algunas paradas en Navarra, pero su finalidad principal es Álava. El GTFS estático aparece válido en NAP, mientras que los recursos SIRI/GTFS-RT asociados aparecen inválidos en el descubrimiento aportado. No se incorpora para evitar cobertura ajena al ámbito. **Descartado.**

## 4. Estado de verificación

| Fuente | Descarga binaria en esta sesión | GTFS actual inspeccionado | Realtime compatible | Estado |
|---|---:|---:|---:|---|
| TUC Pamplona | No | No | No | Pendiente de validación |
| NBus Navarra | No | No | No | Pendiente de validación |
| RENFE | No | No | No declarado | No integrado |
| ALSA | No | No | No declarado | No integrado |

No se han inventado hashes, timestamps GTFS-RT, `trip_id`, `route_id`, posiciones GPS ni predicciones. Para declarar el paquete completamente verificado hacen falta los binarios actuales de los feeds integrados.
