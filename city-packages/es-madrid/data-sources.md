# Madrid: fuentes, decisiones y evidencia

Verificación: **3 de octubre de 2026**, con descargas HTTPS, inspección de ZIP/CSV, XML y protobuf. No se abrió ni se arrancó Transit 3D. Los conteos describen muestras concretas, no el número real de vehículos de toda la red.

## Resultado por operador

| Operador | Fuente operativa | Calidad y fallback |
|---|---|---|
| Metro de Madrid | CRTM GTFS para topología + GIS oficial para L3 + teleindicadores oficiales | Llegadas publicadas y posiciones **estimadas**, nunca GPS. Sin predicciones recientes no se generan vehículos desde el calendario caducado |
| Cercanías Madrid | Renfe GTFS nacional, filtrado a 40 route IDs publicados de Madrid; VehiclePositions y TripUpdates | GPS reciente prioritario, interpolación limitada por el motor existente; estimaciones por TripUpdates y, en ausencia de ambos, horario |
| EMT Madrid | GTFS EMT + MobilityLabs, opcional con credenciales de servidor | Llegadas por parada seleccionada cuando hay autenticación. La flota sigue representándose por horario; no se declara GPS no verificado |
| Interurbanos CRTM | GTFS oficial CRTM | Horario. No se consiguió una fuente pública directa de realtime verificable |
| Urbanos de otros municipios | GTFS oficial CRTM | Horario. Misma limitación de acceso realtime |
| Metro Ligero / Parla | GTFS oficial CRTM; teleindicadores para ML1 | ML1: estimaciones desde llegadas cuando hay evidencia suficiente. ML2, ML3 y ML4: horario. ML1 vuelve al horario si no hay predicciones recientes |

## Metro de Madrid

- [GTFS oficial CRTM](https://www.arcgis.com/sharing/rest/content/items/5c7f2951962540d69ffe8f640d94c246/data): ZIP de **1.503.773 bytes**, 13 rutas, 120 trips antes de expandir frecuencias. Calendario **2025-05-27 → 2026-05-27**, sin servicios activos para octubre de 2026. Se usa exclusivamente como estructura; no se amplía su vigencia.
- [Teleindicadores oficiales](https://serviciosapp.metromadrid.es/servicios/rest/teleindicadores): HTTP 200, **XML**, 546 registros en las dos muestras. Línea, nombre de estación, andén, sentido, próximo y siguiente en minutos. Las fechas de emisión incluyen offset horario. Valores vacíos no significan «0 minutos».
- `FECHAHORAEMISIONPREVISION` es la generación de la predicción. `FECHAHORAREGISTRO` se conserva por separado al parsear. Ninguno se sustituye por la hora de descarga. No hay ID persistente de convoy ni GPS en esta respuesta.
- El feed incluye `linea=0` (R), 1–12 y `51` (ML1). Sus IDs numéricos de estación **no coinciden** con los de GTFS: se unen por nombre normalizado, dentro del patrón de la línea y sentido, descartando ambigüedades.
- La L3 existe en `routes.txt`, pero no tiene trips ni shapes en este ZIP. Se verificó el catálogo oficial, propietario `ConsorcioRegional`, item [63d4ed4b069342f8b3ec959e042ee78b](https://www.arcgis.com/sharing/rest/content/items/63d4ed4b069342f8b3ec959e042ee78b?f=json), que referencia el [servicio geográfico M4_Lineas](https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/M4_Lineas/FeatureServer?f=json).
- L3: capas **20/22** y **24/26**, estaciones y tramos de ambos sentidos. Consultas `/query?f=json&where=1%3D1&outFields=*&outSR=4326&returnGeometry=true` descargadas y analizadas: **19 estaciones y 18 tramos por sentido**, incluyendo El Casar; atributos `FECHAACTUAL=20260413`. Se respetan orden, IDs, curvas y orientación. Se rechazan geometrías discontinuas/truncadas. Los puntos de estación describen el intercambiador: Legazpi queda a 151 m del extremo de tramo, por lo que la validación de estaciones admite 250 m; la continuidad de tramos se valida por separado. No se dibuja una recta para inventar una extensión.

### Estimación y límites

Se correlacionan ETAs de estaciones consecutivas, en la misma línea, sentido y destino, con velocidades plausibles. Una ETA aislada se muestra como llegada, pero no permite colocar un tren. Se deduplican teleindicadores equivalentes. El seguimiento temporal conserva IDs sintéticos internos cuando existe evidencia suficiente; **no identifica el convoy físico**.

La animación incluye una parada **estimada de 20 s**, no una medición del operador. Las anclas de aproximación/dwell están separadas de `arrivalPredictions`: las horas inferidas para animación no aparecen como llegadas oficiales. La velocidad estimada se limita a 30 m/s y el frontend mantiene sus límites de aceleración y corrección ya existentes. El tiempo civil actual no rejuvenece una predicción.

Un único polling agregado compartido por Metro/ML1, como máximo cada **30 s** después de completar la petición; se observaron tiempos de emisión distintos por teleindicador, sin garantía contractual de frecuencia. Datos con más de **180 s** se descartan. Caché del último XML válido en disco, restauración inmediata con recepción desconocida después de reiniciar, y conservación en caso de error/HTML. Topología preparada/caché cada seis horas. Las consultas GIS solo corresponden a cuatro capas al preparar L3, no a cada estación/frame.

Limitaciones: red antigua en líneas distintas de L3, cambios de servicio/cortes parciales, ETA en minutos y ausencia de IDs físicos. Se admite un destino nuevo fuera del GTFS únicamente cuando los extremos publicados permiten inferir inequívocamente el sentido; se cubre solo el tramo con geometría conocida. En R hay solamente dos estaciones y normalmente falta corroboración suficiente: **puede haber llegadas sin tren dibujado**. No se verificó un endpoint de incidencias de Metro utilizable; un teleindicador vacío no se interpreta como cierre del servicio. Si falla la topología de L3, continúan las otras líneas.

## Cercanías Madrid

- [GTFS Renfe](https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip): **13.181.105 bytes**, calendario 1–30 de octubre de 2026. Feed nacional de 841 routes; configuración explícita de 40 IDs reales de Madrid, todos `10T…`, con **37.118 trips estáticos**. Los códigos visibles C1/C2 no se usan para filtrar ciudades.
- [VehiclePositions protobuf](https://gtfsrt.renfe.com/vehicle_positions.pb) y [TripUpdates protobuf](https://gtfsrt.renfe.com/trip_updates.pb), sin credenciales. Renfe [documenta posiciones GPS y actualización aproximada de 20 s](https://data.renfe.com/dataset/ubicacion-vehiculos). El cliente existente consulta cada 15 s; solo nuevas marcas de fuente constituyen nuevas observaciones.
- Se detectaron **18.753 referencias de trips** con shape invertida; se crean **18 copias** de geometría orientada, reutilizadas por trips/sentido. Los arrays originales permanecen intactos. La detección compara proyecciones de la secuencia de paradas, incluidas variantes parciales. La preparación es exclusiva de Madrid: no cambia el tratamiento de Renfe Bilbao.
- La muestra descargada a las 10:45 UTC contenía `SPECIAL_10_91677C7`, `ADDED`, ruta oficial `10T0053C7`, vehículo `91677`, GPS de 10:45:34 UTC, stop `18001` y 14 llamadas con horas absolutas. El trip no existía en GTFS y su secuencia correspondía a otra variante estática C7. Se mantiene su **route_id oficial**, se verifica toda la secuencia de estaciones contra geometría de la **misma línea** y se incorpora el viaje únicamente en memoria. El pipeline aceptó ese GPS y esa actualización, con **0 rutas ajenas a Madrid**. No se altera el protobuf.
- Los viajes añadidos tienen servicio activado solo para sus fechas oficiales, con soporte de medianoche/horas extendidas; caducan junto con sus planes si desaparecen los datos frescos. No se prolongan calendarios históricos. También se incorporan sus llamadas al detalle de parada aunque el índice estático se hubiera creado antes.
- Prioridad existente: GPS válido → movimiento prudente desde observaciones → TripUpdates → horario. Snapping dentro de 120 m sobre geometría verificada; máximo de 40 m/s para Madrid, sin cambiar Bizkaibus. Conserva `vehicle.id`, status de parada, historial y timestamp original. Una observación incoherente se rechaza, sin renovar el GPS anterior.
- La muestra final de las **11:18:34 UTC** devolvió cabeceras actuales pero **0 vehículos y 0 actualizaciones**. Esto es falta de cobertura del proveedor en esa instantánea; no se sustituye por GPS inventado. El fallback en ese caso es horario, claramente etiquetado. No se garantiza cobertura completa de Renfe ni aceptación de viajes cuyas estaciones/geometría no puedan verificarse.

## EMT / MobilityLabs

[Documentación oficial](https://apidocs.emtmadrid.es/) descargada, incluidos sus datos de especificación `api_data.js` (analizados como datos, sin ejecutar código remoto). Portal [OpenAPI EMT](https://openapi.emtmadrid.es/).

Endpoints verificados:

- `GET /v2/mobilitylabs/user/login/`: headers `X-ClientId` y `passKey`; sin credenciales, HTTP 200 con **code 99**, sin sesión autorizada.
- `POST /v2/transport/busemtmad/stops/62/arrives/`: sin token, HTTP **401/code 80**. Body documentado con `cultureInfo`, flags de estimaciones/parada/incidencias; headers `accessToken`. Ninguna petición autenticada se realizó.
- Login documenta `accessToken` y `tokenSecExpiration`; Arrive documenta `line`, `stop`, `bus`, `destination`, `estimateArrive` en segundos y geometría. El sentinel `999999` no es una ETA utilizable.

Configuración de servidor: **`EMT_CLIENT_ID`** y **`EMT_PASSKEY`**, ambas necesarias. Nunca en `city.json`, variables `VITE_*`, logs o frontend. El proceso lee su entorno al arrancar; no carga `.env` automáticamente. `.env` y variantes se ignoran en Git.

Se implementan autenticación, reutilización/concurrencia del token, caché de parada de 30 s, timeout de 8 s, límite de 2 consultas concurrentes/10 por minuto y hasta 100 paradas cacheadas. Se consulta una parada seleccionada o, al seleccionar un viaje, hasta cuatro siguientes; nunca toda la flota. Los errores conservan predicciones que sigan frescas y permiten volver a horario. La API documenta distintas cuotas por modalidad y sus ejemplos no coinciden: **comprobar la cuota del registro**, no dar una cifra universal por garantizada.

`datetime` de la respuesta usa hora civil de Madrid sin offset en el recurso verificado: se convierte con DST, sin confundirla con UTC. Es la generación de la respuesta, **no un timestamp GPS individual**. El adaptador expone llegadas y bus IDs; no coloca buses desde coordenadas que no se hayan podido auditar autenticándose. `positionTypeBus` está documentado como no aplicable en esa versión. Las posiciones de la flota permanecen **SCHEDULE_SIMULATION**, incluso si una parada ofrece llegadas realtime. Incidencias y posición completa no se integran sin una respuesta real validada. Tests de autenticación/parsing usan fixtures de la especificación, no una sesión real.

## CRTM urbanos, interurbanos y Metro Ligero

[Portal oficial](https://datos.crtm.es/) y catálogo ArcGIS de `ConsorcioRegional`: se verificaron los recursos estáticos/servicios geográficos. Sus enlaces API/GeoJSON describen geometría, no VehicleMonitoring. No se obtuvo una URL pública directa verificada de SIRI, GTFS-RT o JSON realtime para los buses CRTM. No se construye un adaptador con endpoints supuestos ni se afirma que CRTM carezca de información realtime internamente.

CRTM [anunció posiciones interurbanas en Google Maps en abril de 2026](https://crtm.es/comunicacion/sala-de-prensa/noticias/noticias/17042026-la-comunidad-de-madrid-incorpora-por-primera-vez-la-posicion-en-tiempo-real-de-los-autobuses-interurbanos-en-google-maps/?lang=en); ese anuncio no publica un feed abierto ni credenciales para terceros. No se usa scraping de Google Maps.

Descargas nuevas analizadas en esta sesión:

| Red | ZIP oficial | Bytes | Rutas | Calendario observado |
|---|---|---:|---:|---|
| EMT | [GTFS](https://servicios.emtmadrid.es:8443/gtfs/transitemt.zip) | 17.749.629 | 238 | 2026-10-02 → 2026-12-31 |
| Urbanos CRTM | [ArcGIS 357e63…](https://www.arcgis.com/sharing/rest/content/items/357e63c2904f43aeb5d8a267a64346d8/data) | 9.119.523 | 117 | 2026-09-10 → 2027-10-10 |
| Interurbanos CRTM | [ArcGIS 885399…](https://www.arcgis.com/sharing/rest/content/items/885399f83408473c8d815e40c5e702b7/data) | 74.153.792 | 354 | 2026-09-10 → 2027-10-10 |
| Metro Ligero/Parla | [ArcGIS aaed26…](https://www.arcgis.com/sharing/rest/content/items/aaed26cc0ff64b0c947ac0bc3e033196/data) | 417.242 | 4 | 2026-07-22 → 2027-07-22 |

Los cuatro feeds contienen servicios activos el día inspeccionado; se respetan excepciones y fechas por servicio, no se toma el rango global como garantía de todas las líneas. Para ML1 se reutiliza el feed agregado de Metro (`linea=51`); sus predicciones reemplazan los stand-ins de horario de esa línea para evitar duplicados. ML2/ML3/ML4 conservan horario. La topología de Metro Ligero procede del mismo GTFS de CRTM.

## Fuentes descartadas y alcance de la validación

- Calendario del GTFS Metro: **descartado como horario actual**, conservado como topología parcial.
- `/servicios/application.wadl` de Metro: HTTP 200 con HTML **Request Rejected**, no una definición de servicios. No se dedujeron endpoints de ese contenido.
- EMT sin credenciales: login no autorizado y llegadas HTTP 401; descartado como realtime público anónimo, preparado para autenticación.
- Coordenadas documentadas por EMT: no usadas como GPS por falta de muestra autenticada/timestamp de observación fiable.
- GeoJSON/GIS CRTM y anuncio de Google: no usados como posiciones actuales de buses.

`npm run audit:madrid` descarga **una muestra** de Metro/GIS y Renfe, sin arrancar la aplicación; valida contra el reloj actual y guarda `server/cache/audit/madrid/runtime-report.json`. `-- --cached` no descarga y reproduce la muestra en su instante de fuente: **no es una medición del estado actual**. Fallos de descarga/caché reutilizada y tiempo de evaluación quedan explícitos. Las muestras finales tenían 546 teleindicadores, ETAs de L3 y ML1, cero GPS de Metro y cero servicios simulados desde su calendario caducado. No se hicieron observaciones visuales ni se esperaron ciclos de movimiento. Los 20 nuevos tests cubren orientación, ADDED, IDs, fechas, tiempos, dwell, stale, fallos, caché, autenticación, capacidades y detalles nativos; siguen pasando los anteriores de Bilbao, Málaga y LOD.

### SHA-256 de los ZIP verificados

```text
metro.zip             16e8e53ce16ab6d73efc2896be7aaeeb351a1f48f661ac7faa0a9e5b38204fb7
renfe.zip             b7464457aea1acfa052aeff7255040b1b377d582ea1675617cfe7841338ad043
emt-madrid.zip        ba0f317260336f8113819915d95e21fbcc25b23d674f3cb1357a0aa076fc72cd
urbanos-crtm.zip      fd18cb709372b2fae6e00234c4b710c4120b1f0d82af51db5595a2043ff1009b
interurbanos-crtm.zip 15c095e739a9acea9459f6f4397fa3820c3d4a4cb2692751b555cba40f9bfef9
light-rail.zip        7e49cfc0980c8e61d96a258d1076ec410a26f66767586d1b1dea49b9caa39467
```
