# Fuentes de datos verificadas

Auditoría realizada el **2 de octubre de 2026** descargando el índice oficial y los ficheros públicos. Los ZIP fueron abiertos y sus tablas leídas; los ficheros GTFS-RT se decodificaron con `gtfs-realtime-bindings`. La presencia de una URL en el índice no se trata como prueba de que contenga posiciones utilizables.

## Resumen

| Operador | GTFS estático (última fecha del índice) | Realtime publicado | Resultado de descarga/parseo observado | Calidad hoy |
|---|---|---|---|---|
| Bizkaibus | [gtfs_bizkaibus.zip](https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfs_bizkaibus.zip), 2026-10-01 | VehiclePositions, TripUpdates y Alerts | VehiclePositions: protobuf válido, 10 entidades con posiciones; TripUpdates: protobuf válido, 10 entidades. El pipeline mapeó 10/10 a shapes. El timestamp de VehiclePositions era 21:58 UTC del día anterior a la descarga (01:33 UTC), por lo que no era fresco. | LIVE solo cuando la posición tiene menos de 45 s; la captura probada se degrada a SCHEDULED/DEGRADED. |
| Bilbobus | [gtfs_bilbobus.zip](https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfs_bilbobus.zip), 2026-10-01 | VehiclePositions | El endpoint del índice se descargó, pero entregó un fichero de 0 bytes; el decodificador no pudo leerlo. No se ha verificado ninguna posición real utilizable. | SCHEDULED hasta que el realtime se recupere y se valide. |
| Metro Bilbao | [gtfs_metro_bilbao.zip](https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip), 2026-10-01 | VehiclePositions y TripUpdates | Ambos ficheros se decodificaron como protobuf, pero cada uno contenía 0 entidades. El contenido actual no ofrece posiciones ni actualizaciones de viaje utilizables. | SCHEDULED. |
| Euskotren (ferrocarril) | [gtfs_euskotren.zip](https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip), 2026-10-01 | VehiclePositions, TripUpdates y Alerts | VehiclePositions: protobuf válido con 0 entidades. TripUpdates: protobuf válido con 120 entidades. Alerts: protobuf válido con 0 entidades. | PREDICTED cuando una TripUpdate se una al mismo viaje/horario; de otro modo SCHEDULED. El parser de TripUpdates aún no está conectado. |

El índice oficial es [`data-index-gtfs.json`](https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs.json) y el índice realtime [`data-index-gtfs-rt.json`](https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs-rt.json). Ambos agrupan los recursos por compañía, formato y hora de actualización. El realtime index anunciaba cambios entre 03:18:27 y 03:18:30 UTC, mientras que el protobuf Bizkaibus descargado tenía una cabecera de 21:58 UTC del día anterior. Esa discrepancia muestra por qué el core verifica el timestamp dentro del propio feed y no confía solo en la hora del índice.

## Validación del GTFS estático

Se validó la estructura ZIP y se leyeron estas tablas requeridas por el core:

| Feed | routes | trips | calendar | calendar_dates | stop_times | shapes |
|---|---:|---:|---:|---:|---:|---:|
| Bizkaibus | 100 | 23.332 | 44 | 442 | 542.489 | 565.781 |
| Bilbobus | 56 | 15.224 | 11 | 24 | 251.400 | 73.534 |
| Metro Bilbao | 1 | 7.747 | 5 | 34 | 199.700 | 12.616 |
| Euskotren | 12 | 5.894 | 18 | 20 | 87.371 | 56.126 |

La auditoría confirma que los tres operadores adicionales tienen los elementos estáticos necesarios para crear vehículos programados. Los conteos son las filas leídas, excluida la cabecera.

## Detalle, protocolos y fallback

### Bizkaibus

- Fuente: Moveuskadi / Gobierno Vasco; GTFS y GTFS-Realtime sobre HTTPS. La implementación actual descarga también el feed de posiciones ya configurado en `server/providers/bizkaibus/config.ts`.
- VehiclePositions disponible y actualmente poblado; TripUpdates y Alerts se anuncian y el feed de TripUpdates también se decodificó con entidades.
- El pipeline legado conserva cache en disco, resuelve `trip_id` con GTFS y rechaza posiciones que no puedan proyectarse razonablemente sobre el shape.
- El refresco configurado de posiciones es de 5 s; el timestamp del feed puede cambiar con menor frecuencia. Mantener el último fichero válido si falla una actualización.
- En la prueba, el feed mapeó 10 buses pero su observación era unas 3 h 35 min más antigua que la descarga. El core los descarta después de 180 s y marca el provider `degraded`; el frontend legado todavía consume directamente el endpoint histórico y no comparte ese control de frescura.
- El índice indicaba actualización a las 03:18:30 UTC en su captura, pero el timestamp del protobuf era de la noche anterior. La cadencia real de publicación no se pudo confirmar.
- Fallback: horario GTFS cuando no se obtiene una observación usable; la calidad del dato no debe seguir etiquetándose como LIVE al envejecer.

### Bilbobus

- Fuente: GTFS oficial de Moveuskadi, feed diario actualizado el 1 de octubre según índice.
- El índice publica un endpoint GTFS-RT VehiclePositions. Al descargarlo el 2 de octubre devolvió cero bytes, no un FeedMessage vacío. No se encontró un TripUpdates ni Alerts en la entrada del operador.
- El recurso anunciaba `last-update` 03:18:27 UTC; es la marca del índice, no una frecuencia garantizada.
- No fijar todavía el recurso realtime en una implementación de producción hasta que una descarga válida se pueda decodificar. Reintentar con tolerancia y conservar el snapshot previo.
- Fallback disponible: `calendar` + `calendar_dates` + `trips` + `stop_times` + `shapes`, calidad SCHEDULED.

### Metro Bilbao

- Fuente: GTFS oficial de Moveuskadi, actualizado el 1 de octubre según índice.
- Se anuncian VehiclePositions y TripUpdates en protobuf GTFS-RT. Los dos endpoints respondieron con FeedMessage válido, pero cero entidades en la descarga auditada.
- El índice marcaba 03:18:27 para VehiclePositions y 03:18:30 para TripUpdates. No puede inferirse un intervalo periódico solo de esta captura.
- Sin posiciones pobladas no se debe comunicar LIVE. Las TripUpdates deberían elevar la calidad a PREDICTED cuando se asocien de forma verificable a un trip y parada.
- Fallback actual: posiciones SCHEDULED calculadas sobre shape y tiempos GTFS; respetar paradas y esperas. No hay modelo ferroviario específico de aceleración/parada implementado aún.

### Euskotren

- Fuente: GTFS oficial de Moveuskadi para Euskotren ferroviario, actualizado el 1 de octubre según índice. El catálogo también contiene un GTFS distinto de “Euskotren bus (Lurraldebus)”; no se mezcla con el feed ferroviario.
- Se anuncian VehiclePositions, TripUpdates y Alerts. En la descarga auditada, TripUpdates tenía 120 entidades, mientras VehiclePositions y Alerts eran FeedMessage válidos con cero entidades.
- El índice anunciaba actualizaciones entre 03:18:27 y 03:18:29 UTC en estos tres recursos; esto es frescura publicada, no una garantía de cadencia.
- TripUpdates pueden aportar retraso/ETA, pero este repositorio todavía no las parsea ni valida su correspondencia con estos viajes GTFS. Hasta entonces, las entidades de movimiento se basan en horarios y se etiquetan SCHEDULED.
- Fallback actual: horario GTFS sobre shapes. Luego se podrá degradar o elevar a PREDICTED según frescura y consistencia de TripUpdates.

## Limitaciones y atribución

- Los feeds en vivo cambian entre descargas; estos resultados son una observación puntual y reproducible, no una promesa de disponibilidad futura.
- El catálogo publica también formatos SIRI y NeTEx para la red de Euskadi, pero no se descargaron ni analizaron en esta fase. No se afirma que los ficheros específicos de estos cuatro operadores aporten más información que GTFS.
- La nota oficial de Moveuskadi describe datos estáticos y en tiempo real y enumera GTFS, GTFS-RT, SIRI y NeTEx: [datos Moveuskadi](https://www.euskadi.eus/contenidos/ds_movilidad/md_ideeu_moveuskadi/es_def/index.shtml) y [anuncio del Gobierno Vasco sobre realtime](https://www.euskadi.eus/gobierno-vasco/-/noticia/2025/moveuskadi-datos-en-tiempo-real-sobre-el-transporte-publico/).
- Los recursos enlazados pertenecen a sus publicadores. Comprobar los términos de reutilización vigentes al distribuir una versión pública.
