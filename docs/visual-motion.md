# Pulido visual y corrección del movimiento

Paquete del 2 de octubre de 2026. Alcance: web actual, LOD y movimiento.
Validación mediante lectura de código, unit tests y build. Sin navegador,
pruebas visuales, capturas ni espera de actualizaciones reales.

## Causas encontradas

1. `vehicle-icon` nunca desaparecía: su opacidad descendía hasta 0,1 mientras
   el modelo 3D ya se dibujaba desde zoom 15. Había dos representaciones.
2. `GpsPlayback` reproducía una cola de observaciones, limitando el cursor a
   la última señal. Esperaba allí y cambiaba a la velocidad del siguiente tramo
   al llegar otro GPS, sin límite de aceleración. Conservaba tiempos de fuente,
   pero ese diseño introducía retraso y ciclos de parada/aceleración.
3. El backend infería retraso con la hora actual cuando el GPS envejecía a
   `predicted`, aunque la posición seguía siendo la del timestamp original.
   Repetir una consulta cambiaba el desfase sin recibir una observación nueva.
4. Las transiciones entre horario y GPS podían compensar una diferencia grande
   mediante un offset de 5–20 s, sin un límite físico de velocidad/aceleración.

Bizkaibus utiliza **GTFS-RT VehiclePositions**, no el SIRI municipal de Bilbobus.
Se mantienen sus timestamps originales en milisegundos y el snapping al shape
exacto. No se modifica la frecuencia de polling.

## Movimiento aplicado

`GpsMotion` predice distancia sobre el shape y conserva posición/velocidad
al aceptar un GPS nuevo. La velocidad proviene de observaciones originales o
velocidad reportada; sin ellas se usa una estimación del timeline. Duplicados
HTTP no reinician el modelo. Un forecast de llegada nuevo puede actualizar el
timeline sin rejuvenecer el GPS.

El timeline se ancla al instante del GPS, conservando futuras llegadas y dwell.
Si solo hay horario teórico y se conoce el ritmo observado, los intervalos de
viaje se estiman a ese ritmo; no se acelera para recuperar el horario. Una ETA
real se conserva como forecast. Estado explícito STOPPED_AT, o velocidad real
cero, mantienen la detención. Predicción de aproximación a una parada conocida
reduce la velocidad para frenar, sin rechazar un GPS que ya la haya superado.

Las correcciones convergen proporcionalmente al error, con horizonte 20–90 s
derivado de la cadencia observada y aporte limitado de 2–8 m/s según el ritmo.
Velocidad absoluta limitada por modo/proveedor, aceleración bus 1,2 m/s² y
otros modos 0,8 m/s². Integración analítica del cambio de velocidad; sin loops
auxiliares ni proyección completa del shape por frame. Si la predicción va por
delante de un GPS nuevo, desacelera/espera; no circula marcha atrás.

Observaciones imposibles se rechazan conservando posición, timestamp y estado
de parada válidos. A 180 s de antigüedad caduca el GPS. El paso al horario también
utiliza el controlador limitado, evitando una recuperación de error en segundos.
La etiqueta es ESTIMADO al predecir fuera de las lecturas reales; INTERPOLADO
entre ellas; REAL únicamente en el progreso observado.

## LOD aplicado

| Zoom | Representación |
|---|---|
| < 11 | Agrupación; siluetas distintas por modo donde hay vehículos individuales |
| 11–14 | Cuerpo 3D básico y techo, con iluminación y silueta propia |
| 14–16 | El mismo cuerpo, con ventanas, ruedas y articulación según modo |
| ≥ 16 | El mismo cuerpo, con luces, puertas y elementos del techo |

Bus, tren, metro, tranvía y funicular tienen formas o proporciones distintas.
Mínimos visuales aproximados: bus 18 px, metro 28, tren 36, tranvía 30; ancho 5 px.
Al acercarse, la escala se aproxima continuamente a metros físicos. Los coches
siguen sus tangentes y se mantiene espacio entre ellos. En los extremos del
shape no se inventa geometría para coches fuera del recorrido disponible.

Un único selector decide entre iconos y modelos para toda la flota. Los iconos
se ocultan antes de habilitar los modelos; no hay crossfade ni dependencia de
la selección. Al cambiar el estilo se repite esa elección. Mientras carga el
módulo, falla su carga, o se supera la capacidad de 4.096 coches, se utilizan
siluetas de modo para toda la flota. El hitbox es invisible; selección con aro
pequeño y tinte del vehículo, sin puntos rellenos enormes.

## Rendimiento y límites

- Un solo requestAnimationFrame; start idempotente y stop libera su solicitud.
  pageshow permite reanudarlo después de recuperar una página del historial.
- Preparación conserva la cadencia anterior: 65 ms escritorio, 85 ms pantalla
  estrecha. Polling del cliente 15 s. Sin nuevos temporizadores de movimiento.
- Shapes/distancias precalculados; conversión progreso → coordenada por búsqueda
  binaria. Matriz/Mercator calculados una vez por coche en la preparación,
  reutilizados por sus partes. El render GPU no reconstruye esas matrices.
- Instancias compartidas, buffers que crecen solo cuando es necesario y uploads
  limitados al rango usado. Retirada del estilo libera geometrías, materiales,
  instancias y renderer; no se fuerza pérdida del contexto compartido del mapa.
- Bundle 3D diferido: 143,80 kB gzip, frente a 133,08 kB antes; incremento por
  iluminación/geometrías. Se descarga desde zoom 11. Main: aproximadamente 292 kB gzip.

**No se han medido FPS ni apariencia real en esta fase.** Mostrar modelos desde
más lejos implica más coches visibles; el instancing reduce llamadas/objetos,
pero la prueba real de fluidez corresponde al usuario. Sigue el aviso de bundles
grandes. Las detenciones y el ritmo entre GPS espaciados son estimaciones;
no permiten conocer una parada o desvío no publicados por el operador.

## Comprobaciones automatizadas

- 40 tests core: incluyendo timestamps, anclaje GPS, estados de parada y retención
  de la última lectura válida al rechazar una imposible.
- 24 frontend: tres ciclos sintéticos de 149 s, duplicados, límites de velocidad
  y aceleración, convergencia, dwell, recuperación tras datos antiguos, LOD,
  escalado continuo, selección sin degradar otros y un solo loop.
- `npm run build`: tipos y build pasando.

## Pruebas manuales a cargo del usuario

1. Recargar la app compilada y alternar vista cenital/perspectiva. Acercar y alejar
   continuamente por zoom aproximado 10, 12, 14, 16 y 18. Debe haber agrupación
   lejos, cuerpos básicos desde 11, ventanas/ruedas desde 14 y detalles desde 16.
   La escala debe cambiar gradualmente; trenes y tranvías deben distinguirse del bus.
2. Seleccionar y deseleccionar un Bilbobus, Bizkaibus y tren con varios vehículos
   alrededor. El resto conserva cuerpos/LOD. No debe aparecer icono/punto junto
   al modelo del mismo vehículo. Repetir tras cambiar apariencia clara/oscura.
3. Revisar una composición ferroviaria en una curva, y buses acercándose a
   paradas. Coches siguen la curva; Bilbobus permanece rojo. Una pausa inferida
   es estimada, no una señal GPS nueva.
4. Con `?debug=1`, seleccionar y seguir un Bizkaibus durante **2–3 cambios del
   campo GPS/sourceTimestamp**, no solo consultas HTTP. Debe avanzar entre señales
   y corregir sin una carrera repentina tras cada una. La señal puede tardar unos
   dos minutos en cambiar; su edad no debe volver a cero con una consulta repetida.
5. Síntomas de fallo: dos cuerpos/icono+modelo, salto de escala en 14/16, flota que
   se convierte en puntos al seleccionar, frenado/aceleración cíclicos bruscos,
   error de progreso que crece continuamente durante tres señales, marcha atrás,
   pérdida notable de fluidez o timestamp GPS que se renueva sin un dato nuevo.

Si ocurre: devolver línea, sentido, trip y shape, zoom/perspectiva, texto del panel
debug antes/después de dos señales y entradas de consola **[transit-motion]** o
**[transit-models]**. Interesan sourceTimestamp, lastIntervalSeconds, cadenceSeconds,
renderedProgress, predictedProgress, renderedSpeed, correctionSpeed,
correctionErrorMeters, rejected, LOD, coches 3D y coste de preparación en ms.

## Archivos del paquete

- Movimiento: src/transit/gpsMotion.ts, progressFollower.ts y gpsMotion.test.ts;
  sustituye gpsPlayback.ts. Tipos/anclaje en server/transit/types.ts,
  gpsTimeline.ts, network.ts y observations.ts.
- GPS normalizado: server/providers/bizkaibus/realtime.ts, service.ts,
  server/providers/realtimeProvider.ts y server/transit/realtime.ts.
- LOD: src/map/vehicleLod.ts, vehicleLod.test.ts, vehicleModels.ts,
  transitRenderer.ts, networkMap.ts y src/transit/vehiclePose.ts.
- Diagnóstico/UI: src/app.ts y src/ui.ts; suites en package.json,
  src/transit/frontend.test.ts y server/transit/realtime.test.ts.
- Documentación: README.md, docs/data-sources.md, motion-engine.md,
  validation.md y este informe. Los cambios previos del usuario en
  src/map/vehicleAnimator.ts y docs/V1_SPEC.md no pertenecen al paquete.
