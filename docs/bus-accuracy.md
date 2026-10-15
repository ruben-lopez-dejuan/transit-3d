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

## «Llegando» y la posición dibujada

La app ponía «Llegando» a un Bizkaibus que se dibujaba a kilómetros de la parada, sobre todo
en los túneles de Artxanda. La hora sale de los tiempos de paso de la Diputación, que reflejan
dónde está el autobús al consultarlos; la posición, del GPS, que llega con 60–90 s de retraso y
se extrapola con el ritmo medio de los últimos 4 minutos. En vía rápida (80–120 km/h; en el feed
se ven 20–35 m/s en ese corredor) eso deja el dibujo 1,5–3 km por detrás. Además, con una
diferencia de más de 1 km el tiempo de paso ni siquiera se emparejaba con el autobús.

- El emparejamiento cuenta con lo que el autobús ha podido recorrer desde su GPS: espera la
  distancia del GPS menos 8 m/s por segundo de antigüedad y acepta hasta 30 m/s.
- Si la Diputación sitúa al autobús más de 250 m por delante de su GPS extrapolado, esa es su
  última observación (`server/transit/officialPosition.ts`), con la velocidad real del tramo.
- Si el autobús dibujado queda más de 800 m por detrás de una observación nueva, se coloca en
  su sitio en vez de perseguirla: la persecución tardaba más de 5 minutos en cubrir 2,8 km.

`server/monitor-arriving.ts` comprueba la coherencia: cada 5 s mide a qué distancia de su
próxima parada se dibuja cada autobús al que la app pone «Llegando».
- En la ficha, una hora estimada (no de la Diputación) ya vencida con el autobús dibujado a más
  de 150 m de la parada pasa a ser el tiempo de recorrer esa distancia a la velocidad dibujada:
  «Llegando» queda para el autobús que está en la parada o al que la Diputación da por llegando.

Medición (5 min, 15 oct 2026): cuando la Diputación da a un Bizkaibus por llegando a una parada,
el mapa lo dibuja a 126 m de mediana de ella (p90 413 m, máximo 775 m), sin ningún caso a más de
1 km. Antes eran 1,5–3 km en el corredor de Artxanda.
