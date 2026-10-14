# Reparación de trazados

Algunos GTFS publican formas mal dibujadas. Se corrigen al preparar el feed
(`server/transit/routedSegments.ts`) con datos revisados y versionados; la app
nunca llama a Overpass ni a un enrutador en producción. La versión de los datos
forma parte de la clave de la caché del feed parseado.

## Corredores ferroviarios

`server/cities/es-bilbao/rail-corridors.json`, generado con
`npx tsx server/import-rail-corridors.ts <respuesta-overpass.json>` (la consulta
está en el script). Si el tramo publicado entre los dos extremos del corredor es
más de 1,3 veces más largo que el corredor, se sustituye en cualquier sentido.

- **Euskotren E3, Sondika – Matiko.** El GTFS iba de Sondika hacia el oeste hasta
  Lutxana (fondo de saco de la lanzadera E3a) y volvía en línea recta 3970 m hasta
  Ola. El corredor sigue la vía de OSM Sondika → Ola → túnel de Artxanda → Matiko:
  4384 m. Las formas E3 pasan de 25,3 a 18,0 km. Auditoría 14 oct 2026.

## Formas que se quedan cortas

`server/cities/es-bilbao/shape-extensions.json`, generado con
`npx tsx server/import-shape-extensions.ts` a partir de los GTFS ya descargados en
`server/cache`. Cada extensión copia la vía de otra forma del mismo feed desde
donde termina la forma corta; se aplica solo si la forma sigue terminando a menos
de 150 m del inicio de la extensión. Va como dato porque el parser solo carga las
formas que usan los viajes del día, y la forma que llega al final puede no estar.

- **Metro Bilbao IBB_BSR (viaje especial 903289, Ibarbengoa → Basauri).** El GTFS
  la publica como copia de IBB_ETX: termina en Etxebarri y deja Ariz a 1477 m y
  Basauri a 944 m del trazado. Sigue por la vía de SIN_BSR, 2927 m más hasta
  Basauri. Auditoría 14 oct 2026.

### Terminales de tren, metro y tranvía

Sin datos aparte: si el primer o el último andén de un viaje ferroviario queda a
más de 150 m de su forma, la forma se prolonga por la vía que dibuja otra forma
del mismo feed que pase a menos de 50 m del final de la forma y del andén (como
mucho 5 km, preferiblemente en el mismo sentido). Los ids de forma de Euskotren
cambian entre publicaciones, así que no se pueden fijar en un fichero.

- **Euskotren E1, servicios cortos.** 13 formas de viajes que empiezan o terminan
  en Traña-Abadiño, Zaldibar, Durango o Azitain-Eibar se cortaban entre 150 y 390 m
  antes del andén; las estaciones están bien situadas (el resto de formas pasan a
  pocos metros). Auditoría 14 oct 2026.

## Tramos rectos por carretera

`server/cities/es-bilbao/routed-segments.json`, generado con
`node --use-system-ca --import tsx server/build-routed-segments.ts` a partir de los
GTFS ya descargados en `server/cache`. Enruta con el OSRM público de demostración
(datos OSM, una petición por segundo) cada tramo recto de más de 1 km en los
feeds de autobús, y de más de 300 m en los que dibujan de parada a parada
(La Unión, Oñati). Si la ruta mide más de 2,2 veces la línea recta, se vuelve a
pedir indicando el sentido de la marcha (`bearings`): una parada junto a una autovía
puede engancharse a la calzada contraria, y la ruta da la vuelta en el siguiente
enlace. Se queda la más corta. Son autocares y en la Álava rural las carreteras
rodean los montes (la 19B Marañón – Bujanda: 5,8 km en línea recta, 17,4 km por
carretera), así que la ruta solo se descarta si un extremo queda a más de 300 m de
una carretera o si mide más de 8 veces la recta, que ya es un bucle. Antes de
descartarla se prueba un último recurso para un extremo que OSRM engancha a otra
carretera: pedir la ruta hasta el punto vecino de la forma y cortarla donde pasa por
ese extremo. OSRM no distingue alturas: un punto dentro de un túnel con un camino
encima puede acabar en el camino.
Los descartes quedan en el propio fichero con su motivo y no se vuelven a pedir,
salvo con `--retry-rejected`.

Auditoría 14 oct 2026: La Unión dibujaba sus 259 formas como rectas entre paradas
(la 3714 Bilbao – Vitoria eran 4 puntos, con un salto de 49,7 km); Alavabus tenía
saltos de 12 a 19 km y PESA más de un centenar de saltos de más de 1 km.

Resultado (14 oct 2026): 1042 tramos enrutados y 123 descartados (97 por ruta demasiado larga, 26 por quedar lejos de una carretera); unos 51 000 puntos. La peor recta de La Unión baja de 49,7 km a unos 2,6 km, tramos rectos de autopista; la 3717 Leioa – Vitoria sigue la carretera por Murgia.

Reintento de los descartes (14 oct 2026): los 123 pasan a enrutarse, entre
ellos la 3720 Bilbao Intermodal – aeropuerto (6,3 km en recta, 14,2 km por carretera),
la 19B, la 20U Pipaón – Faido y la 09B Zuazo de San Millán – Egileor (5,9 km; la
parada queda a 160 m de la carretera). El sentido de la marcha deshace los bucles de
autopista: las Bizkaibus A3512, A3915, A3916, A3923, A3926 y A3933 cerca de Basauri pasan de
9,1 km a 1,3 km. Las más largas respecto a la recta son la 17U Treviño (1,6 km en recta,
11,5 km por carretera) y la 12U Villabezana – San Miguel (2,3 km, 12,1 km). El último, la PESA
DG05 Eibar – Vitoria entre (-2,60226; 42,97121) y (-2,59060; 42,98070), son 1,4 km
dentro del túnel de Zarimutz de la AP-1. El segundo punto queda a 3 m del camino del
barrio de Barreiatua (Leintz-Gatzaga), que pasa por encima, y OSRM daba un rodeo de
23,5 km por la GI-627; enrutado hasta el punto siguiente y cortado, sigue el túnel,
que ahí es recto. No queda ningún descarte. Son
reconstrucciones por carreteras reales, no el recorrido oficial.
