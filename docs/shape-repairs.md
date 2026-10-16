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

## Vías del tranvía

`server/cities/es-bilbao/tram-tracks.json`, generado con
`npx tsx server/import-tracks.ts tram <respuesta-overpass.json>` (la consulta está en
el script): las vías `railway=tram` de Euskal Trenbide Sarea en Bilbao y
Vitoria-Gasteiz, las mismas que muestra OpenRailwayMap, con el sentido de circulación
cuando OSM lo indica (`railway:preferred_direction`, casi todo Vitoria).

Euskotren dibuja el tranvía con un punto cada 40 m, así que cada curva es un polígono
(el giro de Sabino Arana a Euskalduna eran 13 puntos con quiebros de 26° y 36°), y al
pasar por las cocheras de Atxuri la TR alterna puntos de dos vías separadas 20 m. Cada
forma de tranvía se encaja en las vías con un modelo oculto de Markov
(`server/transit/trackMatching.ts`): para cada punto busca las posiciones de vía a menos
de 40 m y elige la secuencia cuyas distancias por la vía mejor cuadran con la forma.
Prefiere la vía en el sentido que dice OSM o, sin etiqueta, la de la derecha; las de
cocheras, apartaderos y escapes solo si la forma va por ellas. Puede saltar a la vía
paralela con un coste fijo, para que unos pocos puntos del andén de Salburua no lleven
el encaje por la vía contraria hasta el escape anterior. Como el tranvía va ya por su
vía, no se le aplica el desplazamiento lateral de 1,7 m del resto de trenes.

Auditoría 14 oct 2026: las 13 formas de tranvía quedan sobre la vía (antes a 1–3 m de
media y hasta 29 m en el túnel Atxuri – Bolueta), sin giros de más de 24° en un vértice
(antes 15–55 por forma, con picos de 175° en Atxuri). La curva de Sabino Arana pasa a 53
puntos y 7° como máximo. Quedan dos tramos por la vía contraria: unos 100 m de la 41 y
la TG2 en el apartadero de (-2,6829; 42,8587), y la llegada de la TG2 a Salburua, que
puede entrar por cualquiera de los dos andenes.

## Vías de Euskotren entre Matiko y Kukullaga

`server/cities/es-bilbao/rail-tracks.json`, generado con
`npx tsx server/import-tracks.ts euskotren <respuesta-overpass.json>` (la consulta está
en el script): las vías `railway=subway|narrow_gauge|rail` de Euskal Trenbide Sarea
desde dentro del túnel de Artxanda hasta la superficie al sur de Kukullaga, sin las de
Metro Bilbao (también de ETS) y quedándose solo con la red unida a la de Euskotren: 50
ways, 16 de ellas escapes, apartaderos y cocheras. Guarda también los andenes de las siete
estaciones: la media de los `stop_position` que OSM pone sobre estas vías (en Zurbaranbarri,
que no tiene, el nodo de la estación, también sobre la vía).

El GTFS dibuja ese túnel (L3, y los E1, E3, E4 y FCC que pasan por él) como un boceto
con un punto cada 50 m: la curva entre Otxarkoaga y Kukullaga es una cuerda que pasa a
177 m de la vía, y cerca de Casco Viejo y Txurdinaga se aparta 60–95 m. Las 37 formas que
lo recorren se encajan con el mismo modelo que el tranvía, con otros parámetros
(`RAIL_TRACK_OPTIONS`): busca vía hasta a 200 m; entre dos vías paralelas sin etiqueta
elige la de la izquierda, porque Euskotren circula por la izquierda en Bizkaia; y solo
encaja el tramo que pasa por estas vías, dejando el resto de la forma como venía. Un
punto más allá de un final de vía suelto (donde el conjunto se corta) a más de 10 m no se
encaja, para que la forma no se amontone en ese final. Lejos de la vía, los nodos junto
al punto más cercano casi empatan con él y dejarían fuera a la otra vía; ahí solo cuenta
un nodo donde la vía se aleja por los dos lados.

Los tramos de una forma que van sobre estas vías o las del tranvía llegan al cliente como
`Shape.onTrack`: ahí el tren no lleva el desplazamiento lateral de 1,7 m (va ya por su vía)
y lo recupera en una rampa de 40 m, más larga al alejar el mapa.

Auditoría 16 oct 2026: las 37 formas quedan sobre la vía de Matiko a Kukullaga, cada
sentido por la suya y sin saltar de una a otra (la otra vía queda a la derecha, a
3,3–3,7 m), sin giros de más de 9° en un vértice (antes 40–51°). La L3 pasa de 5378 a
5568 m. Las costuras con la forma publicada, dentro del túnel de Artxanda y al sur de
Kukullaga, giran 16° como mucho; fuera del tramo las formas no cambian (la vuelta de la
E3 en el andén de Sondika se mantiene). Los túneles siguen saliendo de
`euskotren-tunnels.json`: la L3 va soterrada de la boca de Kukullaga, 150 m al norte de
la estación, hasta Matiko.

El GTFS sitúa estas estaciones en un acceso de calle: Uribarri, Zurbaranbarri, Txurdinaga y
Otxarkoaga quedaban a 95–170 m de la vía, y el tren paraba en el punto de vía más cercano al
acceso, hasta 120 m antes o después del andén. Las paradas de los trenes que pasan por estas
vías con el nombre de una de las estaciones (`Txurdinaga-Bilbao` para `Txurdinaga`) y a menos
de 300 m de ella pasan a su andén (`moveToPlatforms`). Auditoría 16 oct 2026: en las 100
formas de tren de Euskotren ninguna parada va hacia atrás, y las del tramo quedan a 1–7 m
de la forma. Matiko, a 35 m: las formas que empiezan allí arrancan 35 m al este del andén,
como antes.

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
