# Especificación de la V1 (encargo original)

> Documento histórico: es el encargo con el que arrancó la V1, a principios de octubre de 2026, y se conserva tal cual. Lo que hace hoy la app está en el README y en el resto de `docs/`.

Quiero que trabajes directamente sobre mi repositorio existente:

C:\Users\ruben\transit-3d

Este proyecto ya contiene una primera implementación funcional con TypeScript, Vite, MapLibre, Node/Express y datos GTFS/GTFS-RT de Bizkaibus. No quiero que empieces otro proyecto, ni que reemplaces el repositorio entero, ni que pierdas el historial Git.

Tu objetivo es convertir el prototipo actual en la V1 de una aplicación de transporte público en tiempo real para Bilbao/Bizkaia.

============================================================
1. VISIÓN DEL PRODUCTO
============================================================

La aplicación debe ser, conceptualmente, una mezcla entre Flightradar24 y Google Maps aplicada al transporte público.

La interfaz principal debe ser un mapa interactivo donde se vean los vehículos moviéndose por la ciudad.

La V1 debe integrar desde el principio:

- Bizkaibus
- Bilbobus
- Metro Bilbao
- Euskotren

El objetivo principal NO es construir todavía un planificador A → B como Google Maps o Citymapper.

El objetivo es:

"See public transport moving through your city in real time."

La aplicación debe resultar útil para consultar transporte, pero también agradable de explorar simplemente viendo vehículos circular.

============================================================
2. PRINCIPIO FUNDAMENTAL: NO DEPENDER DE UN SOLO OPERADOR
============================================================

La arquitectura actual no debe evolucionar hacia una "app de Bizkaibus".

Bizkaibus debe convertirse simplemente en uno de varios providers.

Quiero una arquitectura aproximadamente así:

BizkaibusProvider ─┐
BilbobusProvider  ─┤
MetroProvider     ─┼──> TransitEngine
EuskotrenProvider ─┘        |
                            v
                       MotionEngine
                            |
                            v
                         Renderer

El mapa/frontend NO debe contener lógica específica de Bizkaibus salvo styling o branding.

Cada proveedor debe normalizar sus datos hacia modelos comunes.

Ejemplo conceptual:

TransitVehicle {
  id
  operatorId
  mode
  tripId
  routeId
  directionId
  shapeId

  latitude
  longitude
  bearing

  progressMeters

  previousStop
  nextStop

  scheduledArrival
  estimatedArrival
  delaySeconds

  positionQuality

  observationTimestamp
  predictionTimestamp
}

positionQuality debe poder distinguir al menos:

"live"
"predicted"
"scheduled"

Los tipos exactos pueden mejorarse, pero esta separación conceptual debe mantenerse.

============================================================
3. FUENTES DE DATOS
============================================================

Investiga las fuentes públicas ACTUALES disponibles para:

- Bizkaibus
- Bilbobus
- Metro Bilbao
- Euskotren

Prioriza:

1. fuentes oficiales del Gobierno Vasco / Moveuskadi;
2. GTFS;
3. GTFS-Realtime;
4. SIRI;
5. NeTEx si aporta datos útiles.

No inventes feeds ni posiciones.

Documenta qué fuente utiliza cada operador.

Comprueba los feeds realmente descargándolos y analizándolos antes de implementar cada provider.

Si un operador tiene posición GPS real utilizable, usarla.

Si no la tiene pero hay TripUpdates/retrasos, utilizar estos datos para estimar la posición.

Si solo existe GTFS estático, representar los vehículos basándose en horarios y marcar su posición como "scheduled".

En particular:

Bizkaibus ya tiene una implementación previa y datos realtime que deben aprovecharse y refactorizarse, no desecharse innecesariamente.

Bilbobus debe aparecer en V1 aunque su posición tenga que ser estimada mediante GTFS.

Metro Bilbao debe aparecer en V1 aunque inicialmente la posición sea estimada.

Euskotren debe aparecer en V1 aunque inicialmente la posición sea estimada.

La falta de GPS NO debe impedir integrar un operador.

============================================================
4. MOTION ENGINE: MUY IMPORTANTE
============================================================

Este es uno de los componentes centrales del proyecto.

Actualmente un feed puede actualizar la posición cada muchos segundos o incluso minutos, lo que provoca saltos muy poco naturales.

NO quiero que los vehículos simplemente se dibujen en la última coordenada recibida.

Quiero desacoplar:

frecuencia de datos
de
frecuencia de renderizado

El vehículo debe moverse continuamente sobre su shape.

Conceptualmente:

GTFS static:
- trips
- shapes
- stops
- stop_times
- calendar
- calendar_dates

+

Realtime:
- VehiclePositions
- TripUpdates
- delays
- SIRI cuando corresponda

↓

MotionEngine

↓

posición continua del vehículo

El MotionEngine debe trabajar preferentemente sobre:

progressMetersAlongShape

en lugar de interpolar directamente latitude/longitude.

Es decir:

tiempo
→
progreso sobre el shape
→
distancia acumulada
→
lat/lon
→
bearing

============================================================
5. MOVIMIENTO ENTRE OBSERVACIONES GPS
============================================================

Ejemplo:

Si recibimos GPS a las:

18:02:00

y no vuelve a llegar otro hasta:

18:04:00

NO quiero:

bus quieto durante dos minutos
+
teletransporte de cientos de metros

Quiero que el sistema estime el progreso durante esos dos minutos utilizando:

- última posición real;
- shape exacto del trip;
- próximas paradas;
- stop_times;
- retraso conocido;
- velocidad/progreso reciente si existe;
- TripUpdates si existen.

El vehículo debe seguir moviéndose.

Cuando llegue una nueva observación GPS, NO debe teletransportarse a la nueva posición.

La nueva observación debe corregir progresivamente el estado predicho.

Por ejemplo, durante aproximadamente 5-20 segundos dependiendo del error.

El resultado visual debe ser una corrección suave.

No hace falta implementar inicialmente un Kalman Filter complejo.

Dado que los vehículos están restringidos a un shape conocido, prioriza un modelo 1D sobre progressMeters.

============================================================
6. HORARIOS Y RETRASOS
============================================================

La posición estimada NO debe ignorar retrasos.

Si un autobús debería estar según horario en progress=18 km, pero sabemos por una observación reciente que solo está en 17 km, el algoritmo debe mantener ese retraso.

No quiero que la simulación empiece a acelerar artificialmente para recuperar el horario teórico.

Utiliza un timeline ajustado por retraso.

Para transporte ferroviario, donde el comportamiento es más predecible, modela:

- salida de estación;
- aceleración;
- velocidad de crucero;
- desaceleración;
- parada en estación.

No es necesario hacer física exacta.

Sí quiero una curva de movimiento visualmente natural.

============================================================
7. GENERACIÓN DE VEHÍCULOS SOLO CON GTFS
============================================================

La aplicación debe ser capaz de determinar qué servicios deberían estar activos utilizando:

calendar.txt
calendar_dates.txt
trips.txt
stop_times.txt
shapes.txt

De esta forma pueden existir vehículos "scheduled" aunque no exista GPS.

Cuando posteriormente aparezca información realtime para ese mismo trip:

scheduled
→ predicted
→ live

La transición debe realizarse sobre el mismo vehículo lógico, sin crear duplicados y sin provocar saltos.

============================================================
8. UX GENERAL
============================================================

El mapa es la aplicación.

No quiero una home tradicional.

Al abrir:

- mapa de Bilbao/Bizkaia a pantalla completa;
- transporte visible;
- buscador flotante;
- filtros de modo;
- controles mínimos.

En móvil:

arriba:
barra de búsqueda

centro:
mapa

abajo:
selector de modos / bottom sheets

En desktop:

mapa ocupando prácticamente toda la pantalla
+
panel lateral cuando se selecciona algo.

La experiencia debe ser responsive desde el principio.

============================================================
9. FILTROS PRINCIPALES
============================================================

El filtro principal debe utilizar MODOS, no operadores.

Por ejemplo:

Todos
Bus
Metro / Rail
Tranvía si procede

No quiero cuatro botones gigantes:

Bizkaibus
Bilbobus
Metro Bilbao
Euskotren

Los operadores pueden aparecer como filtros secundarios.

El usuario normal piensa primero en "bus", "metro" o "tren".

============================================================
10. SELECCIÓN DE UN VEHÍCULO
============================================================

Al tocar un vehículo:

en móvil:
bottom sheet

en desktop:
panel lateral

Debe mostrar, cuando existan los datos:

línea
destino
operador
calidad de posición
próxima parada
ETA próxima parada
retraso
próximas paradas
última actualización realtime

Ejemplo:

A3247                           LIVE ●
Bilbao → Aireportua

Próxima parada
Gran Vía 79                    2 min

+1 min de retraso

● Moyua                        18:34
│
● Gran Vía 79                  18:36
│
○ Sondika                      18:47
│
○ Aireportua                   18:55

Mientras un vehículo está seleccionado:

- destacar su recorrido;
- destacar sus próximas paradas;
- atenuar el resto del mapa.

Añadir opción:

"Seguir vehículo"

Al activarla:

la cámara acompaña suavemente al vehículo.

El usuario puede mover manualmente el mapa.

Debe existir un botón para volver a centrarlo.

============================================================
11. CALIDAD DE POSICIÓN
============================================================

La aplicación debe ser honesta respecto a la precisión.

Estados:

LIVE
PREDICTED
SCHEDULED

LIVE:
GPS/realtime reciente.

PREDICTED:
posición extrapolada desde realtime previo, retraso o TripUpdates.

SCHEDULED:
solo horario teórico.

Mostrarlo discretamente.

Ejemplos:

● LIVE · actualizado hace 12 s
◐ Posición estimada
○ Según horario

No quiero que posiciones calculadas se presenten falsamente como GPS real.

============================================================
12. SELECCIÓN DE PARADA
============================================================

Al tocar una parada debe aparecer:

nombre

y próximos servicios de TODOS los operadores relevantes.

Ejemplo:

Moyua

Próximos servicios

Metro L1 · Plentzia          2 min
Metro L2 · Kabiezes          4 min
Bilbobus 38 · Otxarkoaga     6 min
Bilbobus 28 · Uribarri       9 min

Priorizar ETA realtime/predicho sobre horario cuando exista.

============================================================
13. SELECCIÓN DE LÍNEA
============================================================

Al buscar o seleccionar una línea:

entrar en "modo línea".

Atenuar el resto del transporte.

Mostrar:

- recorrido;
- paradas;
- vehículos activos;
- dirección;
- próximos servicios/salidas.

Debe existir selector de dirección.

Ejemplo:

A3247
Bilbao → Aireportua

3 vehículos en servicio

Próximas salidas:
18:30
18:45
19:00
19:15

La misma UX debe funcionar para:

Bizkaibus
Bilbobus
Metro
Euskotren

No crear interfaces distintas por operador.

============================================================
14. BÚSQUEDA
============================================================

Implementar búsqueda de:

- líneas;
- paradas/estaciones;
- lugares.

Ejemplos:

A3247
L1
Moyua
Plentzia
Aeropuerto
San Mamés

Resultados agrupados conceptualmente en:

LÍNEAS
PARADAS
LUGARES

Seleccionar un lugar debe centrar el mapa y permitir ver transporte cercano.

No implementar todavía route planning completo A → B.

============================================================
15. REPRESENTACIÓN SEGÚN ZOOM
============================================================

Evitar saturar visualmente el mapa.

Zoom bajo:
- simplificación/clustering;
- no mostrar todas las paradas;
- vehículos simplificados.

Zoom medio:
- vehículos individuales;
- líneas relevantes;
- estaciones importantes.

Zoom alto:
- todos los vehículos;
- paradas;
- shapes precisos;
- edificios 3D cuando resulte adecuado.

Zoom muy alto:
- vehículo a escala física aproximadamente real;
- bearing correcto;
- movimiento continuo;
- representación 3D.

============================================================
16. VEHÍCULOS 3D
============================================================

Ya hemos experimentado con buses construidos mediante extrusiones.

No quiero seguir invirtiendo demasiado en construir modelos complejos a mano usando múltiples polígonos.

Investiga una solución limpia y eficiente utilizando modelos 3D ligeros glTF/GLB o una técnica equivalente compatible con MapLibre.

Como mínimo deberían existir modelos conceptuales:

bus
articulated-bus
metro
train
tram

No hace falta que cada modelo reproduzca exactamente cada unidad real.

Prioridades:

1. rendimiento;
2. escala física correcta;
3. dirección correcta;
4. buena apariencia;
5. posibilidad futura de aplicar branding/librea.

Un bus estándar puede aproximarse inicialmente a:

12 m longitud
2.55 m anchura
3.2 m altura

Al alejar el zoom, sustituir el modelo por iconos más sencillos.

No renderizar cientos de modelos 3D pesados simultáneamente.

============================================================
17. MAP MATCHING
============================================================

Mantener y mejorar el principio actual:

trip_id
→ trips.txt
→ shape_id

La posición realtime debe asociarse al shape correcto del trip.

No hacer snap indiscriminado a cualquier carretera/línea cercana.

Cuando existan varias ramas próximas, utilizar:

trip
direction
stop sequence
previous/next stop
history

para evitar cambiar de ramal.

Si una observación es claramente incompatible con el shape:

rechazarla
o mantener temporalmente la predicción.

Es preferible mostrar una posición predicha razonable que teletransportar el vehículo a una posición absurda.

Crear herramientas de diagnóstico suficientes para detectar:

- distancia GPS → shape;
- progress actual;
- progress predicho;
- trip;
- shape;
- stop sequence;
- nueva observación.

============================================================
18. RENDERIZADO Y PERFORMANCE
============================================================

Debe mantenerse fluido en:

desktop
móvil medio Android

El navegador puede renderizar a 60 FPS aunque los feeds actualicen mucho más lentamente.

No realizar procesamiento pesado innecesario cada animation frame.

Precalcular:

- shape metrics;
- cumulative distances;
- stop projections;
- índices de trips.

Mantener caches apropiadas.

Evitar reconstruir geometrías enormes 60 veces por segundo si no es necesario.

============================================================
19. BACKEND
============================================================

Mantener backend Node/Express.

Frontend debe consumir exclusivamente:

/api/*

No quiero que el browser contacte directamente con 10 proveedores diferentes.

Backend responsable de:

- descargar feeds;
- cache;
- parsear GTFS;
- parsear realtime;
- normalizar providers;
- generar snapshot común;
- motion/prediction state cuando sea apropiado.

Diseñar endpoints coherentes.

Puedes cambiar los endpoints actuales si existe una razón arquitectónica buena, pero actualiza frontend y documentación.

============================================================
20. ROBUSTEZ DE FEEDS
============================================================

Los feeds pueden:

- fallar;
- devolver 0 bytes;
- tener certificados problemáticos;
- actualizar tarde;
- cambiar temporalmente;
- devolver datos incompatibles con GTFS static.

La aplicación no debe caerse.

Mantener último snapshot válido cuando tenga sentido.

Registrar:

freshness
provider status
errores

Pero no utilizar silenciosamente datos de hace horas presentándolos como LIVE.

Si un feed realtime deja de funcionar:

LIVE
→ PREDICTED
→ SCHEDULED

según envejezca la última observación.

============================================================
21. PWA / WEB
============================================================

La primera plataforma es web.

Convertir la app en PWA instalable.

Debe poder desplegarse como una única aplicación:

frontend build
+
Express API

Objetivo:

npm run build
npm start

y aplicación disponible desde el backend.

Añadir:

manifest
icons
theme
mobile viewport
installability
service worker si resulta apropiado

No cachear realtime de forma que produzca datos obsoletos.

============================================================
22. ANDROID
============================================================

NO reescribir la aplicación en React Native.

Una vez que la web responsive/PWA esté estable, preparar el proyecto para poder empaquetarlo con Capacitor.

Objetivo futuro:

misma aplicación
→ web
→ Android

Si el entorno permite crear el proyecto Android:

configura Capacitor
añade android
sincroniza el build web

Si no existe Android SDK disponible, deja toda la configuración y scripts preparados y documenta los últimos comandos necesarios.

No publicar nada en Google Play sin mi intervención explícita.

============================================================
23. UI Y DISEÑO
============================================================

Quiero una interfaz moderna, limpia y cartográfica.

Evitar:

- dashboards genéricos;
- exceso de tarjetas;
- gradients gratuitos;
- iconos enormes;
- aspecto de plantilla SaaS;
- "AI slop".

Priorizar:

- mapa;
- buena tipografía;
- jerarquía visual;
- animaciones suaves;
- bottom sheets naturales;
- controles pequeños;
- buen uso del espacio.

El mapa debe seguir siendo protagonista incluso cuando haya algo seleccionado.

Utilizar información y branding de los operadores de forma respetuosa y discreta.

============================================================
24. DARK/LIGHT
============================================================

Implementar diseño compatible con:

light
dark
system

El mapa y los overlays deben seguir siendo legibles en ambos modos.

============================================================
25. ACCESIBILIDAD
============================================================

No depender exclusivamente del color para:

LIVE/PREDICTED/SCHEDULED
operadores
selección

Controles táctiles suficientemente grandes.

Soportar diferentes tamaños de pantalla.

Evitar textos minúsculos ilegibles.

Usar labels/ARIA donde corresponda.

============================================================
26. TESTS
============================================================

Añadir tests útiles, no tests cosméticos.

Especialmente:

GTFS parser
calendar/calendar_dates
active trips
shape distance interpolation
projection sobre shape
bearing
motion interpolation
delay propagation
GPS correction
provider normalization

Añadir también smoke tests de providers que permitan detectar feeds rotos sin depender de que siempre haya vehículos.

No hacer que todo el test suite falle simplemente porque un proveedor externo esté temporalmente caído.

Separar tests unitarios de integration/provider tests.

============================================================
27. DEBUG / DESARROLLO
============================================================

Crear un modo de diagnóstico opcional útil para desarrollo.

Por ejemplo:

?debug=1

que pueda mostrar:

raw GPS
matched position
predicted position
shape
distance to shape
progress
next stop
positionQuality

Esto nos ayudará muchísimo a corregir errores visuales.

No mostrarlo al usuario normal.

============================================================
28. GIT
============================================================

MUY IMPORTANTE:

No borres .git.
No hagas git init.
No hagas hard reset destructivo.
No reemplaces todo el repositorio por otro proyecto.

Antes de tocar nada:

git status
git branch
git log --oneline -10

Trabaja sobre el repositorio actual.

Haz commits pequeños y coherentes por fases.

Por ejemplo, conceptualmente:

refactor: introduce normalized transit provider model

feat: add multi-provider transit engine

feat: add scheduled vehicle prediction

feat: add continuous motion engine

feat: integrate Metro Bilbao

feat: integrate Euskotren

feat: integrate Bilbobus

feat: redesign map-first transit UI

feat: add PWA support

chore: prepare Capacitor Android wrapper

No es obligatorio usar exactamente esos mensajes.

NO hagas un único commit gigantesco al final.

============================================================
29. NO ROMPER LO QUE YA FUNCIONA
============================================================

La implementación actual de Bizkaibus funciona parcialmente.

Antes de refactorizar:

entiende cómo funciona.

Preserva aquello que sea válido:

- GTFS downloader;
- realtime downloader;
- cache;
- map matching;
- frontend map;
- route selection;
- polling;
- MapLibre setup.

Refactoriza de forma incremental.

Después de cada fase:

npm run build

y ejecuta tests relevantes.

============================================================
30. INVESTIGACIÓN ANTES DE IMPLEMENTAR
============================================================

Antes de integrar Metro Bilbao, Euskotren y Bilbobus:

investiga realmente los feeds actuales.

Documenta en:

docs/data-sources.md

Para cada operador quiero:

operator
static GTFS URL/source
realtime source
protocol
vehicle positions available?
trip updates available?
alerts available?
refresh interval observed
known limitations
fallback strategy

No des por válido un feed únicamente porque aparezca catalogado.

Descárgalo y comprueba contenido actual.

============================================================
31. DOCUMENTACIÓN
============================================================

Actualizar README.

Debe explicar:

arquitectura
providers
MotionEngine
LIVE/PREDICTED/SCHEDULED
cómo arrancar
cómo hacer build
cómo ejecutar tests
cómo usar debug
cómo desplegar web
cómo preparar Android

Añadir también:

docs/architecture.md
docs/data-sources.md
docs/motion-engine.md

============================================================
32. CRITERIOS DE ACEPTACIÓN DE V1
============================================================

Consideraré la V1 correctamente implementada cuando:

La app abre directamente en un mapa funcional.

Bizkaibus aparece.

Bilbobus aparece.

Metro Bilbao aparece.

Euskotren aparece.

Cada vehículo conoce su positionQuality.

Los vehículos scheduled se generan desde GTFS.

Los vehículos realtime no saltan bruscamente entre observaciones normales.

Los vehículos permanecen sobre sus shapes.

Los vehículos tienen bearing coherente con la ruta.

Puede seleccionarse un vehículo.

Puede seleccionarse una parada.

Puede seleccionarse una línea.

Existe búsqueda.

Existe filtrado por modo.

La UX móvil utiliza bottom sheets.

Desktop utiliza panel lateral cuando sea apropiado.

El movimiento continúa aunque no llegue un nuevo GPS durante unos segundos/minutos.

Una nueva observación corrige suavemente la predicción.

Las posiciones estimadas no se muestran como GPS real.

La aplicación funciona responsive.

npm run build pasa.

Los tests relevantes pasan.

La web puede ejecutarse con npm start después del build.

Existe PWA instalable o, si algún obstáculo técnico concreto lo impide, queda documentado.

Capacitor queda preparado para Android.

============================================================
33. FORMA DE TRABAJAR
============================================================

No me preguntes por decisiones menores que puedas resolver técnicamente.

Investiga, implementa, prueba y corrige.

Sí detente si necesitas:

- credenciales privadas;
- pagar por un servicio;
- realizar una acción irreversible;
- publicar externamente;
- elegir entre dos alternativas de producto que cambien sustancialmente la UX.

Prioriza una implementación funcional completa antes que detalles visuales extremadamente finos.

No falsees funcionalidad.

Si un provider solo puede tener movimiento basado en horarios, impleméntalo correctamente y márcalo como SCHEDULED.

Si encuentras realtime mejor, aprovéchalo.

============================================================
34. ORDEN RECOMENDADO
============================================================

Quiero que trabajes aproximadamente en este orden:

1. inspeccionar repo y estado Git;
2. verificar build/tests actuales;
3. investigar feeds de los cuatro operadores;
4. diseñar modelo normalizado;
5. refactorizar Bizkaibus al modelo común;
6. implementar calendario + active trips;
7. implementar MotionEngine;
8. implementar posiciones scheduled/predicted;
9. integrar Metro Bilbao;
10. integrar Euskotren;
11. integrar Bilbobus;
12. rehacer UX map-first multioperador;
13. búsqueda/paradas/líneas;
14. mejorar renderer y representación por zoom;
15. PWA;
16. Capacitor;
17. tests;
18. documentación;
19. revisión final de performance y errores.

Puedes adaptar el orden si descubres dependencias técnicas mejores.

============================================================
35. RESULTADO FINAL
============================================================

Cuando termines quiero que me entregues:

- aplicación funcionando;
- todos los cambios en el repo;
- historial de commits razonable;
- build pasando;
- tests;
- documentación;
- resumen de los feeds encontrados;
- qué operadores están LIVE/PREDICTED/SCHEDULED;
- instrucciones para ejecutar localmente;
- instrucciones para desplegar la web;
- estado de preparación Android;
- limitaciones conocidas;
- siguientes mejoras recomendadas.

No quiero solamente un análisis o un plan.

Quiero que ejecutes el trabajo de ingeniería sobre el repositorio y dejes una versión funcional.
