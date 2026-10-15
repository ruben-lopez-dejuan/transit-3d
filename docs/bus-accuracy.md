# Precisión de los autobuses en el mapa

## Cómo se mide

`server/monitor-bus-accuracy.ts` usa como verdad el GPS real de los operadores:

```powershell
node --use-system-ca --import tsx server/monitor-bus-accuracy.ts 25 bus-accuracy.jsonl
```

Con la API en marcha (`npm start`, puerto 3001), ejecuta el propio `TransitRenderer` del
navegador con las instantáneas de `/api/transit` cada 15 s, como la app, y anota dónde
dibuja cada autobús. Aparte consulta el GPS en bruto (Bizkaibus cada 5 s, Bilbobus cada
15 s). Por cada GPS nuevo tomado en el instante t compara el GPS con dónde dibujaba el
mapa ese autobús en t: error a lo largo de la forma (+ por delante, − por detrás),
distancia en el mapa y distancia del GPS a la forma. Una fila JSON por GPS.

## Qué limita la precisión (auditoría 15 oct 2026)

| | Bizkaibus | Bilbobus |
|---|---|---|
| Un GPS por autobús cada | 63 s | 20 s |
| Antigüedad del GPS al descargarlo | 62 s (p90 88 s) | 25 s (p90 33 s) |
| Distancia del GPS a su forma | 2 m (p90 6 m) | 2 m (p90 9 m) |

El encaje en la forma no es el problema: el mapa siempre dibuja una predicción de uno a
dos minutos por delante del último GPS, y la precisión depende de esa predicción.

Causas encontradas:

- **Ritmo del horario.** Los autobuses con GPS seguían el horario teórico desplazado
  para pasar por el último GPS. En Bilbao ese ritmo es más rápido que el real: Bilbobus
  salía 107 m por delante de mediana y, tras un GPS parado (semáforo, parada), 172 m.
  Ahora se mueven con su ritmo medio de los últimos 4 minutos de GPS
  (`ObservationTracker.pace`). En la serie real, a 40 s vista ese ritmo acierta con 74 m
  de mediana y sin sesgo, frente a 98 m del ritmo del último tramo y 114 m quedándose
  quieto.
- **Minutos oficiales de Bizkaibus.** Los tiempos de paso de la Diputación no tienen
  sesgo, pero en un 10 % de los casos el autobús llega 4 minutos antes de lo anunciado.
  Mover el autobús con ellos daba 335 m de mediana y más de 1,2 km en el peor 10 %. Ahora
  solo dan las horas que se muestran; el movimiento usa el GPS y el ritmo observado.
- **Consulta de Bilbobus cada 30 s.** El dato dibujado llegaba a tener más de un minuto.
  Ahora el servidor lo pide cada 15 s.

Se probó también usar los metros de los tiempos de paso oficiales como posición: reflejan
la posición en el instante de la consulta, pero en ese instante aciertan lo mismo que el
último GPS más el ritmo medio (114 m frente a 110 m de mediana); combinarlos solo mejora
el peor 25 %, a cambio de mezclar dos fuentes en el movimiento. No se usan.

De los 255 autobuses del feed de Bizkaibus, unos 25 se descartan porque su GPS queda a
kilómetros de la forma de su viaje (en vacío o con el viaje mal asignado), y unos 50
esperan en cabecera a la salida de su viaje: no se muestran hasta esa hora.

## Resultado y lo que queda

Medición tras los cambios (25 min, mismo método):

| | Antes | Después |
|---|---|---|
| Bilbobus, distancia en el mapa (mediana / p90) | 121 / 322 m | 94 / 266 m |
| Bilbobus, sesgo a lo largo | 107 m por delante | 18 m |
| Bizkaibus, distancia en el mapa (mediana / p90) | 286 / 1031 m | 270 / 907 m |
| Bizkaibus, sesgo a lo largo | 123 m por delante | −15 m |

La posición objetivo de la predicción acierta más que lo dibujado: 64 m de mediana en
Bilbobus y 237 m en Bizkaibus. La diferencia es el seguidor, que nunca hace retroceder al
autobús: cuando un GPS nuevo muestra que iba más lento de lo previsto, el dibujado ya se
ha pasado y espera parado (Bilbobus el 45 % del tiempo, 111 m por delante de mediana;
Bizkaibus 247 m); cuando va por detrás, la aceleración limitada lo recupera despacio.
