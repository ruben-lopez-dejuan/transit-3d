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

## Tramos rectos por carretera

`server/cities/es-bilbao/routed-segments.json`, generado con
`node --use-system-ca --import tsx server/build-routed-segments.ts` a partir de los
GTFS ya descargados en `server/cache`. Enruta con el OSRM público de demostración
(datos OSM, una petición por segundo) cada tramo recto de más de 1 km en los
feeds de autobús, y de más de 300 m en los que dibujan de parada a parada
(La Unión, Oñati). Una ruta se descarta si un extremo queda a más de 150 m de una
carretera o si mide más de 2,2 veces la línea recta: probablemente es otra carretera.
Los descartes quedan en el propio fichero con su motivo y no se vuelven a pedir.

Auditoría 14 oct 2026: La Unión dibujaba sus 259 formas como rectas entre paradas
(la 3714 Bilbao – Vitoria eran 4 puntos, con un salto de 49,7 km); Alavabus tenía
saltos de 12 a 19 km y PESA más de un centenar de saltos de más de 1 km.
