# Fuentes de datos verificadas

## Madrid — integración del 3 de octubre de 2026

La evidencia detallada está en [es-madrid/data-sources.md](../city-packages/es-madrid/data-sources.md).
Se descargaron y analizaron las fuentes oficiales durante esta sesión, sin abrir
la aplicación ni hacer pruebas visuales.

| Red | Fuente final | Calidad |
|---|---|---|
| Metro Madrid | CRTM GTFS como topología; GIS oficial L3 hasta El Casar; XML de teleindicadores Metro | Llegadas reales del proveedor, posición estimada; nunca GPS ni horario caducado |
| Cercanías Madrid | Renfe GTFS nacional filtrado, VP y TU | GPS cuando existe; interpolación/TripUpdates y horario como fallback; shapes orientadas y viajes ADDED verificados |
| EMT | GTFS y MobilityLabs con `EMT_CLIENT_ID`/`EMT_PASSKEY` opcionales | Llegadas por parada autenticadas; flota por horario. Sin muestra autenticada no se declara GPS |
| CRTM urbanos/interurbanos | GTFS oficial vigente | Horario; no se obtuvo un endpoint realtime público verificable |
| ML1 / ML2 / ML3 / Parla | CRTM GTFS; teleindicadores para ML1 | ML1 estimado por llegadas cuando están disponibles; demás horario |

Los feeds de Renfe pueden responder vacíos aunque la cabecera sea reciente.
El GPS ADDED observado inicialmente se aceptó; la muestra final no tenía
vehículos. Metro se consulta de forma agregada cada 30 s; los timestamps de
emisión son independientes del registro, recepción y animación. `audit:madrid`
genera un informe sin arrancar el servidor. No se cambian las fuentes ni la
interpolación corregida de Bizkaibus.

## Euskadi

Auditoría del **2 de octubre de 2026**. Se descargaron ZIP, se leyeron las tablas y se decodificaron los protobuf. Los índices públicos son [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs.json) y [GTFS-RT](https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs-rt.json). Una URL o un timestamp de catálogo no acreditan posiciones reales. Scripts reproducibles: server/audit-realtime.ts, server/audit-realtime-joins.ts y server/audit-moveuskadi.ts. Los resultados crudos se guardan en server/cache/audit, ignorado por Git.

## Revisión de la integración de Euskadi — 3 de octubre de 2026

Muestra única descargada y decodificada entre **10:17:50 y 10:17:51 UTC**;
Bilbobus JSON a continuación. No se abrió la aplicación, no se hicieron
pruebas visuales ni se esperaron ciclos sucesivos. Los ZIP existentes del
runtime se cargaron para comprobar los IDs de viaje y paradas.

| Fuente | Resultado de la muestra | Interpretación |
|---|---|---|
| Bizkaibus VP | 187 entidades; 187 viajes presentes en GTFS; 163 posiciones aceptadas por el normalizador común; cabecera de 160 s | GPS disponible con publicación espaciada. La ruta histórica de Bizkaibus conserva su map matching y tracker propios |
| Bizkaibus TU | 188 entidades; 184 actualizaciones normalizadas | Predicciones disponibles; no deben borrar GPS vigente por una discrepancia con el fin estimado de un viaje |
| Bilbobus JSON, línea 18/IDA | HTTP 200; 2 posiciones recientes | GPS municipal sigue disponible; G1/IDA devolvió 0 filas, no un error HTTP |
| Metro Bilbao TU | 59 viajes reconocidos; 51 actualizaciones vigentes normalizadas | Llegadas realtime; posición calculada, sin GPS |
| Euskotren TU | 253 viajes reconocidos y actualizaciones normalizadas | Llegadas realtime para tren/tranvía cuando el viaje está cubierto; posición calculada, sin GPS |
| Tuvisa VP/TU | 42 GPS reconocidos, 41 aceptados; 115 actualizaciones normalizadas | GPS y predicciones disponibles |
| Dbus VP/TU | 40 entidades y viajes reconocidos en cada feed; 0 posiciones/actualizaciones aceptadas | Las observaciones estaban caducadas aunque la cabecera tenía 150 s. Se mantiene horario; una nueva consulta no renueva esos datos |
| Renfe nacional VP/TU | 2 entidades en cada feed; ninguna pertenece a los viajes de Euskadi cargados | La muestra solo incluía viajes ADDED de Madrid, fuera de esta red. Se mantiene horario en Euskadi; no se inventan posiciones ni se eliminan filtros territoriales |

Una respuesta posterior del pipeline local entregó 84 Bilbobus, 136 Bizkaibus
y 41 Tuvisa con observaciones GPS, además de 31 Euskotren y 15 Metro con
posiciones estimadas a partir de predicciones. Son conteos de esa respuesta,
no una garantía de cobertura ni una validación visual del movimiento.
Las fuentes siguen siendo las oficiales documentadas más abajo; no se han
sustituido endpoints ni ampliado artificialmente la caducidad de 180 s.

Correcciones:

- El servidor local se reactivó tras la parada durante el cambio de carpeta.
- Los lectores GTFS-RT restauran la caché validada en la primera petición,
  mientras refrescan en segundo plano. Solo se utiliza si sus timestamps
  siguen vigentes; la recepción desconocida después de un reinicio es null.
- Bizkaibus valida el protobuf descargado antes de reemplazar la caché anterior.
  Una descarga inválida o un fallo no rejuvenecen la última observación.
- TripUpdates no elimina el GPS vigente del adapter base por un límite de
  horario estimado. Una cancelación oficial sí elimina el viaje.
- La salud del provider explica cuándo un feed recibido está vacío o no aporta
  observaciones vigentes compatibles, en vez de ocultar el motivo del fallback.

Diagnóstico reproducible: `npm run audit:euskadi-realtime`. Descarga **una sola
muestra** por fuente conectada y comprueba timestamps, uniones y normalización.
Guarda protobuf y `report.json` en `server/cache/audit/euskadi`, fuera de Git.
La disponibilidad y los conteos cambiarán con la hora de ejecución.

## Fuentes utilizadas y calidad

### Migración al núcleo modular

Esta fase conserva las fuentes de la auditoría anterior; no se han realizado
nuevas descargas ni observaciones de feeds. Configuración:
`server/cities/es-bilbao`. Los adapters mantienen las consultas existentes.
Solo se registra Bilbao, con la cobertura regional que ya existía.

El manifest declara capacidades conectadas: Bizkaibus VP/TU; Bilbobus posiciones
municipales y llegadas por parada (no GTFS-RT TripUpdates); Metro/Euskotren TU
sin GPS; Renfe VP/TU. Alertas, ocupación y rumbo reportado permanecen desactivados.
La velocidad municipal Bilbobus es una capacidad del feed; velocidad/rumbo
derivados de shapes/historial no se anuncian como campos reportados.
Capacidad no equivale a feed fresco: `ProviderHealth` indica estado independiente.

La API separa timestamp de origen, recepción y consulta/evaluación. Realtime
caducado retiene su hora para diagnosticar `stale` mientras usa fallback;
recepción desconocida es null. En estáticos, mtime local del ZIP es recepción
de cache, no generación del GTFS. La posición dibujada tiene su propio diagnóstico.
IDs externos se conservan para joins oficiales; internos usan ciudad/provider/tipo.
Detalle: [modular-core.md](modular-core.md).

| Operador | Fuente/protocolo | Información realmente disponible | Posición y fallback |
|---|---|---|---|
| Bizkaibus | Moveuskadi, GTFS + GTFS-RT VP/TU HTTPS | GPS con trip_id y stop_id; predicciones por parada | B: GPS e interpolación entre timestamps reales. Si supera 180 s, horario/estimado |
| Bilbobus | GTFS Moveuskadi; API municipal JSON; SOAP SIRI | GPS físico, velocidad km/h; ETA oficial por parada/vehículo | B: GPS/interpolado; unión al viaje GTFS estimada. Si no hay GPS fresco, horario |
| Metro Bilbao | Moveuskadi GTFS + TripUpdates protobuf | Llegadas actualizadas; VP sin entidades | C: posición ESTIMADA a partir de ETA; D cuando no hay TU fresca. Nunca GPS |
| Euskotren tren y tranvías Bilbao/Vitoria | Moveuskadi GTFS + TripUpdates | ETA asociada exactamente a viaje y secuencia; VP vacío | C/D, posición ESTIMADA; capas independientes, un solo feed |
| Renfe Bilbao y Donostia | GTFS nacional oficial + VP/TU oficiales | GPS con viaje exacto y ETA | B si hay GPS válido; C con TU; D con horario. Sin crear GPS para viajes ausentes |
| Dbus | Moveuskadi GTFS + VP/TU | GPS y ETA con trip_id exactos; capturas posteriores también antiguas | B/C cuando fresco; D al caducar |
| Tuvisa | Moveuskadi GTFS + VP/TU | GPS y ETA con trip_id exactos, cadencia irregular | B/C cuando fresco; D al caducar |
| Funicular Artxanda | GTFS oficial Moveuskadi | 2 estaciones, geometría, 1.243 viajes explícitos, 8 calendarios, 39 excepciones | D: posición ESTIMADA, trayecto programado de 3 min y frecuencias publicadas |
| Otros operadores de la tabla siguiente | GTFS oficial Moveuskadi | Geometría, paradas y servicio/calendar_dates | D: posiciones ESTIMADAS según horario |

A = GPS observado sin interpolación; B = GPS observado + interpolación; C = predicciones de llegada; D = horario estático; E = simulación ajena a servicio real. No se crean vehículos E ni se presentan C/D como GPS. La animación D es una estimación visual del servicio programado, no una observación física.

## Endpoints principales

- Bizkaibus [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfs_bizkaibus.zip), [GPS](https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_Bizkaibus_vehicle_positions.pb), [TU](https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_bizkaibus_trip_updates.pb).
- Bilbobus [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfs_bilbobus.zip), JSON GET **https://api.bilbao.eus/bilbobus/Ultimas_posiciones/{LINEA}/{IDA|VLT}**, [SIRI](https://api.bilbao.eus/sae/SIRI.svc).
- Metro [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip), [TU](https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfsrt_metro_bilbao_trip_updates.pb).
- Euskotren [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip), [TU](https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfsrt_euskotren_trip_updates.pb).
- Renfe [GTFS](https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip), [GPS](https://gtfsrt.renfe.com/vehicle_positions.pb), [TU](https://gtfsrt.renfe.com/trip_updates.pb). Documentación oficial: [horarios](https://data.renfe.com/dataset/horarios-cercanias), [ubicación](https://data.renfe.com/dataset/ubicacion-vehiculos). El espejo Moveuskadi descargado fue byte a byte idéntico; no aportaba mejoras frente al feed oficial.

### Bilbobus: detalles de interoperabilidad

La API municipal devolvió posiciones utilizables para líneas como 18, 10 y A7. lineIdPerm coincide con route_id GTFS. Ruta 1 corresponde a dirección 0/IDA y Ruta 2 a 1/VLT. Vehiculo identifica el bus físico; Viaje no es trip_id GTFS. Se asocia a una geometría/dirección y horario próximos, se marca tripIdentityQuality=estimated, y se suprimen los vehículos de horario duplicados de direcciones con GPS válido. No se atribuyen retrasos oficiales a esa unión estimada.

CoordX/CoordY son **ED50 UTM 30N / EPSG:23030**. Se aplica transformación a WGS84 con el desplazamiento de datum estándar [-87,-98,-121]; no basta cambiar de proyección. Ejemplo verificado: (503631,4790217) → (-2.9565231,43.2628654). Precisión del desplazamiento regional aproximada, no centimétrica.

**Instante está codificado como hora civil de Madrid aunque termine en Z.** Comparación repetida con HTTP Date y SIRI: +2 h en octubre. El adaptador municipal lo convierte explícitamente con Europe/Madrid y prueba también el offset invernal. Las fechas UTC reales de SIRI y GTFS-RT no reciben esa corrección.

SIRI usa SOAP 1.1 POST, Content-Type text/xml y SOAPAction **http://tempuri.org/ISIRI/GetStopMonitoring**. Se descargaron WSDL y esquemas públicos. MonitoringRef requiere **stop_code** (1101 verificado), no stop_id (1 rechazado). RecordedAtTime y ExpectedArrivalTime son UTC válidos. VehicleRef VEH_767 se cruza con el vehículo físico; el journey SIRI no se fuerza a trip_id GTFS. Las consultas se limitan a la parada seleccionada o las tres próximas paradas, con caché de 20 s.

La posición municipal se consulta por líneas/direcciones activas, hasta seis solicitudes concurrentes, cada 30 s. No se hace una llamada por vehículo ni por todas las paradas del mapa.

### Renfe

El ZIP nacional analizado contenía 841 rutas, 104.896 viajes, 1.139 paradas, 1.486.864 stop_times, 123.734 puntos de shape y 450 calendarios. Se seleccionan núcleos **60 (Bilbao)** y **61 (Donostia)**, con filtro territorial sobre las paradas reales. Se excluyen líneas de León/Guardo incluidas bajo el núcleo 60. El resultado actual contiene 24 rutas, 12.527 viajes y conserva los IDs para unir realtime. El feed incluye también servicios sustitutorios de bus de Donostia: se conserva su modo publicado.

Las cabeceras/valores CSV tienen espacios de relleno; el parser los normaliza. Algunos shapes de C1/C2/C4/C5 están invertidos respecto a las paradas: se invierten los puntos verificados conservando la geometría. Ciertas expediciones C5 publican geometría incompleta (p. ej. Karrantza–Concordia): se conservan horarios y se omite la posición cuando las paradas no ajustan a su shape. No se dibuja una vía inventada.

El publicador describe las posiciones como GPS, con actualización de 20 s. Algunas lecturas son discretas o próximas a estaciones; esa descripción no acredita precisión continua. En la observación real apareció un salto equivalente a **240 km/h**. Se rechaza mediante el tracker común, con máximo configurable de **40 m/s para Renfe**, margen sobre los 120 km/h del [material Civia documentado por Renfe](https://www.renfe.com/es/es/cercanias/cercanias-madrid/rodajes/unidad-465). Se conserva la última posición válida y su timestamp original hasta su caducidad.

## Moveuskadi: todos los feeds adicionales descargados

Conteos antes de expandir frecuencias: rutas / viajes / paradas. El registro modular server/providers/moveuskadi-sources.json contiene las URLs exactas; catalog.ts instancia proveedores comunes. Solo se habilita realtime cuando hay entidades, unión a GTFS y timestamps utilizables.

| Operador | Fuente | Rutas / viajes / paradas | Resultado realtime / fallback |
|---|---|---:|---|
| Lasarte (Muittu Manttangorri) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/muittu_manttangorri_lasarte/gtfs_muittu_manttangorri_lasarte.zip) | 3 / 44 / 38 | Sin RT publicado verificado; horario |
| Guipuzkoana (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/guipuzkoana/gtfs_guipuzkoana.zip) | 9 / 639 / 179 | RT probado: vacío o antiguo; horario |
| EtxeBarriBus | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/etxebarribus/gtfs_etxebarribus.zip) | 2 / 199 / 24 | RT probado: vacío o antiguo; horario |
| Goierrialdea (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/goierrialdea/gtfs_goierrialdea.zip) | 10 / 1115 / 203 | RT probado: vacío o antiguo; horario |
| Ekialdebus (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/ekialdebus/gtfs_ekialdebus.zip) | 24 / 1080 / 227 | RT probado: vacío o antiguo; horario |
| Irunbus | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/irunbus/gtfs_irunbus.zip) | 5 / 1010 / 77 | Sin RT publicado verificado; horario |
| Hernaniko hiribusa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/hernaniko_hiribusa/gtfs_hernaniko_hiribusa.zip) | 2 / 73 / 27 | RT probado: vacío o antiguo; horario |
| Urbano de Tolosa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/tolosa/gtfs_tolosa.zip) | 1 / 47 / 26 | RT probado: vacío o antiguo; horario |
| Tbh (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/tbh/gtfs_tbh.zip) | 18 / 2378 / 241 | RT probado: vacío o antiguo; horario |
| Pesa (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/pesa/gtfs_pesa.zip) | 26 / 3961 / 196 | RT probado: vacío o antiguo; horario |
| Bermibusa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/bermibusa/gtfs_bermibusa.zip) | 1 / 30 / 20 | RT probado: vacío o antiguo; horario |
| Euskotren bus (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/euskotren_bus/gtfs_euskotren_bus.zip) | 14 / 1139 / 236 | RT probado: vacío o antiguo; horario |
| Tolosaldea (Lurraldebus) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lurraldebus/tolosaldea/gtfs_tolosaldea.zip) | 21 / 822 / 237 | RT probado: vacío o antiguo; horario |
| Funicular Artxanda | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/funicular_artxanda/gtfs_funicular_artxanda.zip) | 1 / 1243 / 2 | Sin RT publicado verificado; horario |
| Oñati | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/onati/gtfs_onati.zip) | 1 / 61 / 32 | RT probado: vacío o antiguo; horario |
| Erandio! busa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/erandio_busa/gtfs_erandio_busa.zip) | 2 / 48 / 55 | RT probado: vacío o antiguo; horario |
| Dbus | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/dbus/gtfs_dbus.zip) | 49 / 23309 / 540 | GPS + TripUpdates verificados; fallback por antigüedad |
| Puente Colgante | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/pte_colgante/gtfs_pte_colgante.zip) | 1 / 8 / 2 | Sin RT publicado verificado; horario |
| Tuvisa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/tuvisa/gtfs_tuvisa.zip) | 31 / 4368 / 368 | GPS + TripUpdates verificados; fallback por antigüedad |
| Xorrola (Oiartzun) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/oiartzun/gtfs_xorrola_oiartzun.zip) | 1 / 48 / 16 | RT probado: vacío o antiguo; horario |
| AlavaBus | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/alavabus/gtfs_alavabus.zip) | 53 / 2386 / 696 | GPS/TripUpdates descartados: timestamp de entidad +2 h |
| Udalbus (Eibar) | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/eibar/gtfs_udalbus_eibar.zip) | 2 / 47 / 38 | RT probado: vacío o antiguo; horario |
| Lejoan busa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/lejoan_busa/gtfs_lejoan_busa.zip) | 3 / 163 / 30 | RT probado: vacío o antiguo; horario |
| Sopelbus | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/sopelbus/gtfs_sopelbus.zip) | 4 / 33 / 18 | RT probado: vacío o antiguo; horario |
| La Unión | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/la_union/gtfs_la_union.zip) | 11 / 211 / 106 | Sin RT publicado verificado; horario |
| Zarauzko hiribusa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/zarauzko_hiribusa/gtfs_zarauzko_hiribusa.zip) | 6 / 242 / 36 | RT probado: vacío o antiguo; horario |
| Kbus | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/kbus/gtfs_kbus.zip) | 4 / 278 / 88 | RT probado: vacío o antiguo; horario |
| Errenteria Urbanoa | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/errenteria/gtfs_errenteriako_urbanoa.zip) | 9 / 293 / 82 | RT probado: vacío o antiguo; horario |
| Arrasate | [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/arrasate/gtfs_arrasate.zip) | 1 / 103 / 54 | RT probado: vacío o antiguo; horario |

Puente Colgante publica frequencies.txt: sus 8 plantillas se expanden en **615 expediciones estimadas**, respetando el límite exclusivo de end_time y los horarios superiores a 24 h. exact_times=0 no garantiza una salida física en el segundo calculado. Artxanda utiliza los viajes explícitos de su feed, sin inventar horarios ni dibujar una recta entre estaciones.

## Fuentes probadas y descartadas

- [Bilbobus municipal GTFS-RT](https://www.bilbao.eus/opendata/datos/bilbobus-gtfs-rt): HTTP 200, **0 bytes**. [Moveuskadi Bilbobus VP](https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfsrt_bilbobus_vehicle_positions.pb): **0 bytes**. Sustituidos por JSON municipal/SIRI real.
- VehiclePositions de Metro y Euskotren: protobuf válido sin vehículos en las capturas. Se usan sus TripUpdates; no se afirma GPS.
- Lurraldebus y varias redes locales: ficheros de 15 bytes con 0 entidades; algunos timestamps de junio de 2025. No aportan realtime utilizable pese a las fechas actuales del índice.
- AlavaBus VP/TU: entidades y uniones reales (19/22 GPS y 25/25 TU en la auditoría), pero timestamp de entidad **dos horas por delante** de cabecera/UTC. No se habilita ni se aplica una corrección global sin verificar todos sus tiempos de parada; alternativa disponible: GTFS estático.
- SIRI GetVehicleMonitoring municipal sin VehicleRef: aviso de identificador desconocido; no se usa como endpoint agregado.
- En la auditoría anterior, Overpass devolvió HTTP 406 (overpass-api.de) y 429
  (overpass.kumi.systems). Para Euskotren, el 3 de octubre se obtuvo una respuesta
  válida de la instancia principal mediante POST; private.coffee agotó el timeout.
  El primer filtro solo railway=rail no incluía narrow_gauge de Euskotren;
  se amplió antes de seleccionar infraestructura ETS. Detalle en la sección siguiente.
- La descarga nativa Node de algunos dominios del Gobierno Vasco falló por confianza TLS del entorno. Se usa el almacén de certificados de Windows mediante el descargador existente; no se desactiva TLS.

## Infraestructura ferroviaria y representación

[Pliego oficial de mantenimiento Metro Bilbao, anexo 2, pp. 78–79](https://www.contratacion.euskadi.eus/webkpe00-kpeperfi/es/contenidos/anuncio_contratacion/expjaso37360/es_doc/adjuntos/lugar_descarga_3_1.pdf): tramo común y L2 en túnel, salvo Etxebarri–Bolueta y viaducto de Urbinaga; Basauri–Ariz en túnel. Se traduce a intervalos sobre shapes y estaciones reales. Profundidad visual **aproximada de 12 m**, transiciones aproximadas cerca de límites. Los coches se representan transparentes bajo el mapa y se pueden ocultar en Capas. No se afirma que exista un levantamiento exacto de cotas/portales; soterramientos aislados de L1 quedan pendientes.

Separación lateral de 1,7 m por sentido a escala física para distinguir trenes/tranvías en los shapes compartidos. En el LOD lejano se amplía con el ancho mínimo de representación. Es diagramática; no es un inventario exacto de vías. C4/C5 de Renfe conservan la vía sin offset. Composiciones estilizadas por modo/operador, longitud aproximada; cada coche obtiene posición y tangente independientes sobre la curva.

### Túneles de Euskotren — 3 de octubre de 2026

Geometría descargada realmente de [Overpass](https://overpass-api.de/api/interpreter),
con datos [OpenStreetMap, ODbL](https://www.openstreetmap.org/copyright).
Snapshot de origen: **2026-10-02 22:36:47 UTC**. Se seleccionan 201 ways y
2.426 puntos de vías activas ETS: narrow_gauge, gauge=1000 y tunnel=yes.
Se excluyen vías en construcción/abandonadas, Metro L1/L2, otros operadores
y las vías no electrificadas. Los IDs OSM y la consulta se guardan en el dataset.

Se cruza esta infraestructura con los shapes GTFS existentes, sin cambiar sus
coordenadas. L3, E1, E2, E3 y E4 tienen tramos identificados en ambos sentidos;
también hay coincidencias en E3a y los servicios FCC. Tranvías y funicular no
heredan túneles ferroviarios. L3 queda continua después del portal de Kukullaga;
E3 incluye Artxanda y el tramo común con L3.

La continuidad se verifica con nodos compartidos entre ways. Los desajustes
locales GTFS/OSM no se rellenan por simple proximidad: requieren el mismo túnel
conectado, un entorno geométrico acotado y ausencia de retorno al mismo portal.
Profundidad visual aproximada de 12 m y transiciones existentes, sin afirmar
cotas medidas ni inventario completo. Portales y posiciones pueden diferir
entre fuentes; infraestructura no mapeada/con correspondencia insuficiente
permanece en superficie.

Contraste oficial: [ETS, L3 y conexión Artxanda](https://www.irekia.euskadi.eus/es/news/44884-una-exposicion-recuerda-primer-aniversario-linea-del-metro-bilbao)
y [ETS, trazado del Topo](https://www.topo.eus/proyecto).
No se consultan feeds realtime ni Overpass al arrancar para obtener esta
infraestructura. Dataset local, índice espacial y caché por shape.
Reproducción y pruebas: [euskotren-tunnels.md](euskotren-tunnels.md).

## Frescura, movimiento y arquitectura

- observationTimestamp: hora del GPS original; timetableTimestamp: hora de la predicción del operador; fetchedAt: consulta al servidor; GpsMotion.motionTimestamp: instante del cálculo visual. Consultar HTTP no rejuvenece ninguno de los dos primeros.
- REAL = GPS observado (primera lectura o última lectura alcanzada); INTERPOLADO = movimiento entre GPS; ESTIMADO = posición calculada con ETA o GTFS. La ficha explica su procedencia y edad. Datos con más de 180 s no se mantienen como observaciones actuales.
- El predictor sobre metros del shape utiliza velocidad/cadencia observadas y próximas paradas. Nuevas lecturas corrigen sin saltar posición ni velocidad. Corrección limitada y aceleración máxima: bus 1,2 m/s², otros modos 0,8 m/s². Predicción fuera del último GPS = ESTIMADO; no se presenta como señal nueva. Al caducar a 180 s se usa el fallback de horario.
- Se observaron intervalos de **149 s en Bizkaibus** en capturas anteriores. El paquete de pulido los cubre mediante secuencias sintéticas unitarias de tres ciclos; no se ha vuelto a observar el feed. Duplicados HTTP no reinician movimiento ni cadencia. No se acumula una cola de observaciones para capas ocultas.
- Las geometrías transferidas conservan vértices de curvas cortas; solo se omiten puntos próximos cuya desviación respecto a la cuerda no supera 0,5 m. No se añaden trazados ajenos al feed.
- Snapping común a geometría, umbral de 120 m para GPS. El tracker rechaza timestamps regresivos, grandes retrocesos y velocidades imposibles según modo; no se aplican cambios de identidad arbitrarios para tapar errores.
- Los horarios conservan dwell publicado. Para buses sin tiempo de parada explícito se ilustra una pausa estimada de 6 s cuando cabe antes de la siguiente llegada, sin modificar la hora publicada. **No se impone a GPS real.**
- TU: fecha de servicio/calendario, viaje y secuencia exactos; cancelaciones, SKIPPED, NO_DATA, absolute time y delay=0. No se aceptan DIFFERENTIAL, viajes añadidos sin GTFS ni uniones ambiguas.
- Refresco independiente en segundo plano, caché válida con fallo aislado por operador. Primer mapa puede mostrar horario mientras llegan los primeros feeds realtime. GTFS diario/caché 6 h y snapshot común 5 s; cliente 15 s.
- Catálogo multi-provider, modelos comunes y renderer común. No se requiere crear una animación distinta para cada proveedor nuevo.

Términos/atribución pertenecen a cada publicador; [documentación oficial Moveuskadi](https://www.euskadi.eus/contenidos/ds_movilidad/md_ideeu_moveuskadi/es_def/index.shtml). La disponibilidad y la población de realtime varían durante el día; estas observaciones no garantizan servicio externo continuo.
