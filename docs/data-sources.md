# Fuentes de datos verificadas

Auditoría del **2 de octubre de 2026**. Se descargaron ZIP, se leyeron las tablas y se decodificaron los protobuf. Los índices públicos son [GTFS](https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs.json) y [GTFS-RT](https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs-rt.json). Una URL o un timestamp de catálogo no acreditan posiciones reales. Scripts reproducibles: server/audit-realtime.ts, server/audit-realtime-joins.ts y server/audit-moveuskadi.ts. Los resultados crudos se guardan en server/cache/audit, ignorado por Git.

## Fuentes utilizadas y calidad

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
- Overpass público para infraestructura: overpass-api.de devolvió HTTP 406 y overpass.kumi.systems HTTP 429. Se utilizó documentación oficial de Metro, sin inventar respuestas OSM.
- La descarga nativa Node de algunos dominios del Gobierno Vasco falló por confianza TLS del entorno. Se usa el almacén de certificados de Windows mediante el descargador existente; no se desactiva TLS.

## Infraestructura ferroviaria y representación

[Pliego oficial de mantenimiento Metro Bilbao, anexo 2, pp. 78–79](https://www.contratacion.euskadi.eus/webkpe00-kpeperfi/es/contenidos/anuncio_contratacion/expjaso37360/es_doc/adjuntos/lugar_descarga_3_1.pdf): tramo común y L2 en túnel, salvo Etxebarri–Bolueta y viaducto de Urbinaga; Basauri–Ariz en túnel. Se traduce a intervalos sobre shapes y estaciones reales. Profundidad visual **aproximada de 12 m**, transiciones aproximadas cerca de límites. Los coches se representan transparentes bajo el mapa y se pueden ocultar en Capas. No se afirma que exista un levantamiento exacto de cotas/portales; soterramientos aislados de L1 quedan pendientes.

Separación lateral de 1,7 m por sentido para distinguir trenes/tranvías en los shapes compartidos. Es una separación diagramática; no es un inventario exacto de vías. C4/C5 de Renfe conservan la vía sin offset. Composiciones estilizadas por modo/operador, longitud aproximada; cada coche obtiene posición y tangente independientes sobre la curva.

## Frescura, movimiento y arquitectura

- observationTimestamp: hora del GPS original; timetableTimestamp: hora de la predicción del operador; fetchedAt: consulta al servidor; GpsPlayback.renderedAt: tiempo de la observación reproducida. Consultar HTTP no rejuvenece ninguno de los dos primeros.
- REAL = GPS observado (primera lectura o última lectura alcanzada); INTERPOLADO = movimiento entre GPS; ESTIMADO = posición calculada con ETA o GTFS. La ficha explica su procedencia y edad. Datos con más de 180 s no se mantienen como observaciones actuales.
- La reproducción GPS recorre una distancia observada durante el tiempo real entre timestamps, sin comprimir intervalos de 25–90 s a 5–20 s ni añadir 7,5 m/s constantes. Si no llega otra observación, se detiene en la última.
- Se observaron intervalos de **149 s en Bizkaibus**: la reproducción conserva esos 149 s. El reloj también avanza para capas ocultas; activarlas no reproduce una cola antigua.
- Las geometrías transferidas conservan vértices de curvas cortas; solo se omiten puntos próximos cuya desviación respecto a la cuerda no supera 0,5 m. No se añaden trazados ajenos al feed.
- Snapping común a geometría, umbral de 120 m para GPS. El tracker rechaza timestamps regresivos, grandes retrocesos y velocidades imposibles según modo; no se aplican cambios de identidad arbitrarios para tapar errores.
- Los horarios conservan dwell publicado. Para buses sin tiempo de parada explícito se ilustra una pausa estimada de 6 s cuando cabe antes de la siguiente llegada, sin modificar la hora publicada. **No se impone a GPS real.**
- TU: fecha de servicio/calendario, viaje y secuencia exactos; cancelaciones, SKIPPED, NO_DATA, absolute time y delay=0. No se aceptan DIFFERENTIAL, viajes añadidos sin GTFS ni uniones ambiguas.
- Refresco independiente en segundo plano, caché válida con fallo aislado por operador. Primer mapa puede mostrar horario mientras llegan los primeros feeds realtime. GTFS diario/caché 6 h y snapshot común 5 s; cliente 15 s.
- Catálogo multi-provider, modelos comunes y renderer común. No se requiere crear una animación distinta para cada proveedor nuevo.

Términos/atribución pertenecen a cada publicador; [documentación oficial Moveuskadi](https://www.euskadi.eus/contenidos/ds_movilidad/md_ideeu_moveuskadi/es_def/index.shtml). La disponibilidad y la población de realtime varían durante el día; estas observaciones no garantizan servicio externo continuo.
