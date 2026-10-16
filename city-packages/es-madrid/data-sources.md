# Madrid: fuentes, decisiones y evidencia

Verificación: **3 de octubre de 2026**; mediciones con la app en marcha el **16 de octubre de 2026** (ver [Medición del 16 de octubre](#medición-del-16-de-octubre-de-2026)). Primera verificación, con descargas HTTPS, inspección de ZIP/CSV, XML y protobuf. No se abrió ni se arrancó Transit 3D. Los conteos describen muestras concretas, no el número real de vehículos de toda la red.

## Resultado por operador

| Operador | Fuente operativa | Calidad y fallback |
|---|---|---|
| Metro de Madrid | CRTM GTFS para topología + GIS oficial para L3 + teleindicadores oficiales | Llegadas publicadas y posiciones **estimadas**, nunca GPS. Sin predicciones recientes no se generan vehículos desde el calendario caducado |
| Cercanías Madrid | Renfe GTFS nacional, filtrado a 40 route IDs publicados de Madrid; VehiclePositions y TripUpdates | GPS reciente prioritario, interpolación limitada por el motor existente; estimaciones por TripUpdates y, en ausencia de ambos, horario |
| EMT Madrid | GTFS EMT + MobilityLabs, opcional con credenciales de servidor | Llegadas por parada consultada. Los buses que llegan a esas paradas se mueven con la estimación de EMT (retraso del viaje desde su ETA y `DistanceBus`); el resto de la flota, horario. No se declara GPS |
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

Se correlacionan ETAs de estaciones consecutivas, en la misma línea, sentido y destino, con velocidades plausibles. Una ETA aislada se muestra como llegada, pero no permite colocar un tren nuevo. Se deduplican teleindicadores equivalentes. Cada tren dibujado es un id sintético que **no identifica el convoy físico**, pero se mantiene mientras avanza:

- Cada actualización se empareja con el tren que mejor continúa: donde lo pone ahora su última línea de tiempo publicada, asignando primero los pares más cercanos (−400/+600 m, −700/+1000 m si comparten una ETA a ±90 s). Antes se exigía la misma ETA en una estación común y el tren cambiaba de id en cuanto cambiaba la cadena.
- Un tren caduca cuando ningún teleindicador reciente lo confirma, no cuando el más antiguo de su cadena pasa de 270 s (cada panel se emite a su hora; p90 de antigüedad ~140 s).
- Una ETA suelta en la estación siguiente mantiene un tren ya conocido (último tramo antes de la cabecera, panel ausente). Sin ninguna prueba sigue su última línea de tiempo durante 60 s.
- Nunca retrocede: una ETA más pesimista lo deja esperando; si va por detrás, alcanza la nueva estimación a 25 m/s como máximo. Dos trenes del mismo sentido a menos de 250 m son uno: queda el id más antiguo.

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
- **Publicaciones sin Madrid** (16/10, muestreo cada 5 s): Renfe publica VehiclePositions y TripUpdates nacionales cada ~20 s y aproximadamente una de cada tres **no trae ningún viaje del núcleo 10** (296 entidades con 95 trenes de Madrid, luego 202 con ninguno). La app tomaba esa publicación como «sin observaciones»: los ~60 trenes pasaban a su posición de horario durante ~20 s y volvían al GPS, a kilómetros. Ahora una publicación sin ningún viaje de Madrid (trip_id `10…`/`SPECIAL_10_…` o una de sus rutas) no sustituye a la anterior mientras esta siga fresca (270 s), con sus horas de fuente y recepción.
- **VehiclePositions no es un GPS continuo** (medido el 16/10, 58 trenes durante 3 min): la posición de un tren se queda fija 1–2 min mientras su timestamp avanza cada ~20 s y luego salta kilómetros de golpe (C7 de 64,8 a 72,2 km en 20 s; C1 +6 km); hasta la mitad de los trenes están a menos de 30 m de una estación y todas las posiciones caen sobre la vía (0 m de distancia lateral). La app rechazaba ese salto (>40 m/s) y también cada fix posterior que lo confirmaba, así que el tren se quedaba congelado hasta 270 s. Ahora un salto imposible que el siguiente fix confirma (en ≤120 s) se acepta como nuevo punto de partida, sin inventar velocidad; un fix aislado que el siguiente contradice sigue ignorándose.
- La muestra final de las **11:18:34 UTC** devolvió cabeceras actuales pero **0 vehículos y 0 actualizaciones**. Esto es falta de cobertura del proveedor en esa instantánea; no se sustituye por GPS inventado. El fallback en ese caso es horario, claramente etiquetado. No se garantiza cobertura completa de Renfe ni aceptación de viajes cuyas estaciones/geometría no puedan verificarse.

## EMT / MobilityLabs

[Documentación oficial](https://apidocs.emtmadrid.es/) descargada, incluidos sus datos de especificación `api_data.js` (analizados como datos, sin ejecutar código remoto). Portal [OpenAPI EMT](https://openapi.emtmadrid.es/).

Endpoints verificados:

- `GET /v2/mobilitylabs/user/login/`: headers `X-ClientId` y `passKey`; sin credenciales, HTTP 200 con **code 99**, sin sesión autorizada.
- `POST /v2/transport/busemtmad/stops/62/arrives/`: sin token, HTTP **401/code 80**. Body documentado con `cultureInfo`, flags de estimaciones/parada/incidencias; headers `accessToken`. Ninguna petición autenticada se realizó.
- Login documenta `accessToken` y `tokenSecExpiration`; Arrive documenta `line`, `stop`, `bus`, `destination`, `estimateArrive` en segundos y geometría. El sentinel `999999` no es una ETA utilizable (también aparece `888888`).

Con credenciales reales (16/10/2026):

- El login responde **code 01** («Token extend into control-cache») cuando ya hay una sesión abierta con esas credenciales, por ejemplo Railway y un servidor local a la vez; `arrives` responde **01** («No estimations found») en una parada sin buses próximos. Ambos son respuestas válidas; antes se trataban como fallo y se perdían las llegadas.
- Cuota de la cuenta: `apiCounter.dailyUse` = **250 000 llamadas/día**, compartida por todas las instancias con las mismas credenciales. El contador de la mañana iba por unos cientos.
- Cada `Arrive` trae, por bus: `estimateArrive`, **`DistanceBus`** (metros hasta la parada **por el recorrido**: un N4 a 600 m en línea recta daba 33 km) y `geometry` (coordenadas del bus). En 8 minutos de muestreo cada 10 s, `geometry` solo cambió cada **230–252 s**, sin hora propia del fix; `DistanceBus` cambia cada pocos segundos porque EMT lo extrapola y lo corrige al llegar un fix nuevo. No hay endpoint documentado de posiciones de flota: solo `arrives` por parada.

Configuración de servidor: **`EMT_CLIENT_ID`** y **`EMT_PASSKEY`**, ambas necesarias. Nunca en `city.json`, variables `VITE_*`, logs o frontend. Los scripts `npm run dev` y `npm start` cargan el `.env` local al arrancar; en despliegues las credenciales se inyectan como variables del servicio. `.env` y variantes se ignoran en Git.

Se implementan autenticación, reutilización/concurrencia del token, caché de parada de 30 s, timeout de 8 s, límite de 2 consultas concurrentes/10 por minuto y hasta 100 paradas cacheadas. Se consulta una parada seleccionada o, al seleccionar un viaje, hasta cuatro siguientes; nunca toda la flota. Los errores conservan predicciones que sigan frescas y permiten volver a horario. La API documenta distintas cuotas por modalidad y sus ejemplos no coinciden: **comprobar la cuota del registro**, no dar una cifra universal por garantizada.

`datetime` de la respuesta usa hora civil de Madrid sin offset en el recurso verificado: se convierte con DST, sin confundirla con UTC. Es la generación de la respuesta, **no un timestamp GPS individual**. `positionTypeBus` está documentado como no aplicable en esa versión.

**Buses de las paradas consultadas.** Las coordenadas de `geometry` no se usan (hasta 4 min de antigüedad desconocida). Lo que se usa es la ETA de EMT: cada bus se une al viaje del horario que está haciendo y ese viaje recibe como TripUpdate el retraso que implica la ETA, así que el bus del horario se dibuja donde dice EMT (`PROVIDER_ESTIMATED`, con su número de bus y su llegada en la ficha del viaje). Reglas: por línea y parada los buses toman los viajes en el mismo orden (no se adelantan), con la menor desviación total; entre 15 min antes (los nocturnos llegan a Cibeles muy adelantados) y 20 min después; solo viajes ya empezados; y `DistanceBus` debe encajar con la posición del viaje desplazado (600 m + 25 % de la distancia). Un bus visto en varias paradas conserva un viaje. No hay consultas extra: se reutilizan las llegadas que se piden al abrir una parada (máx. 10/min y 30 s de caché por instancia); cuando dejan de ser frescas (270 s) el bus vuelve al horario. El resto de la flota sigue en **SCHEDULE_SIMULATION**. Los tests de autenticación, parsing y unión usan fixtures, no una sesión real.

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

## Medición del 16 de octubre de 2026

`npm run monitor:madrid` con la app local en marcha: cada 15 s lee `/api/transit`, resume por operador y, en Cercanías, compara cada posición del feed de Renfe con dónde estaba dibujado ese tren en ese instante (el `TransitRenderer` del navegador). `npm run replay:metro-madrid` reproduce capturas de teleindicadores sin red ni app. La punta de la mañana se perdió (el equipo se suspendió): son mediciones de **día laborable a media mañana**, no de hora punta.

| Fuente (11:06–11:16) | Vehículos | Origen de la posición | Antigüedad del dato (mediana / p90) | Ids por vehículo | Retrocesos / saltos |
|---|---:|---|---|---:|---|
| Metro de Madrid | 156 | estimada desde teleindicadores | 71 / 136 s | 1,48 | 0 / 53 en 5695 pasos |
| Cercanías | 63 | GPS 89 %, horario 6 %, TripUpdates 5 % | 46 / 161 s | 1,17 | 82 / 203 en 2304 pasos |
| Cercanías con los arreglos (13:15–13:30) | 67 | GPS 96 %, horario 3 %, TripUpdates 1 % | 41 / 79 s | 1,24 | 146 / 332 en 3936 pasos (siguen los saltos del propio feed) |
| EMT | 1555 | horario 96 %, estimación EMT 4 % (9 paradas consultadas) | 39 / 78 s (llegadas) | 1,22 | 248 / 72 en 57 171 pasos |
| Urbanos CRTM | 171 | horario | — | 1,34 | 0 / 0 |
| Interurbanos CRTM | 1079 | horario | — | 1,23 | 0 / 611 |
| Metro Ligero | 15 | horario; ML1 estimado | 93 / 244 s | 1,5 | 0 / 0 |

Retroceso: más de 20 m hacia atrás entre dos lecturas; salto: más de 25 m/s. «Ids por vehículo» incluye los que entran y salen de servicio en la ventana.

**Metro, mismo conjunto de capturas con el seguimiento anterior y el nuevo** (`replay:metro-madrid`, paso de 15 s):

| Capturas | Trenes dibujados | Ids distintos | Vida mediana de un id | Retrocesos | Saltos |
|---|---:|---:|---:|---:|---:|
| Día, 11:06–11:16 (20) | 94 → **155** | 501 → **221** | 135 → **510 s** | 109 → **0** | 104 → **13** |
| Noche, 01:14–01:30 (46) | 25 → **46** | 179 → **78** | 75 → **435 s** | 37 → **0** | 45 → **2** |

**Cercanías.** Posición del servidor frente al feed de Renfe del mismo instante (55–65 trenes, mediana / p90): **2360 / 5621 m** antes de los dos arreglos, **0 / 1784 m** y **147 / 5128 m** en dos muestras después. Sin el arreglo de publicaciones sin Madrid, 2 de cada 8 instantáneas no tenían ningún tren en GPS; después, 12 de 12 con 60–63. En el mapa, comparando solo fixes en los que la posición cambió (el resto repite una posición vieja con hora nueva): **2185 / 3384 m** a lo largo de la vía (456 fixes, sesgo mediano +1166 m, el mapa por delante; distancia en el mapa 2072 / 6153 m). El feed no es la verdad: es una posición que se renueva a saltos y muchas veces es la de la estación, así que el error frente a él tiene un mínimo que la app no puede bajar. Medido aparte con el mismo renderer, el mapa dibuja estos trenes a **1002 / 4296 m** de la posición que da el servidor en ese momento (+567 m por delante de mediana): entre dos saltos del feed el navegador sigue moviendo el tren con el horario y el servidor lo mantiene quieto en la posición vieja. Mejorarlo de verdad exige modelar el tren desde TripUpdates y su estado en estación (`STOPPED_AT` + `stopId`), como se hace con el Metro: queda pendiente. De los ~95 trenes que el feed sitúa en la Comunidad, la app dibuja ~65 con GPS: los demás no se emparejan con ningún viaje dibujado (queda por investigar si son viajes fuera de las 40 rutas o trip_id que no casan).

## Fuentes descartadas y alcance de la validación

- Calendario del GTFS Metro: **descartado como horario actual**, conservado como topología parcial.
- `/servicios/application.wadl` de Metro: HTTP 200 con HTML **Request Rejected**, no una definición de servicios. No se dedujeron endpoints de ese contenido.
- EMT sin credenciales: login no autorizado y llegadas HTTP 401; descartado como realtime público anónimo, preparado para autenticación.
- Coordenadas (`geometry`) de EMT: renovadas cada ~4 min y sin hora del fix; no se usan como GPS. Sí se usan su ETA y `DistanceBus`.
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
