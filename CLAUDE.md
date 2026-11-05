# Transit 3D: traspaso para Claude

Documento para que una cuenta nueva de Claude retome el proyecto sin perder contexto.
Recoge cómo trabaja Rubén, cómo está hecha la app, las decisiones tomadas y lo que queda
pendiente. Estado a 5 de noviembre de 2026 (último commit en master: `0b885ec`).

Claude Code lee este `CLAUDE.md` solo al empezar cada sesión en el repositorio. En un
Proyecto de claude.ai, súbelo como conocimiento del proyecto. Mantenlo al día cuando
cambien las decisiones, el estado o lo pendiente.

---

## 1. Qué es

**Transit 3D** es un mapa 3D en tiempo real del transporte público de Euskadi: autobuses,
metro, trenes, tranvías y funiculares de Bizkaia, Gipuzkoa y Álava, dibujados donde están
ahora mismo. En hora punta hay más de 850 vehículos en el mapa, casi la mitad con posición
en tiempo real. Hay además paquetes de ciudad para Madrid, Málaga, Navarra y València.

- Repositorio: https://github.com/ruben-lopez-dejuan/transit-3d (rama `master`).
- Carpeta local: `C:\Users\ruben\transit-3d` (Windows 11, PowerShell y Git Bash).
- Despliegue: Railway, a partir de `master` (`railway.toml`: `npm ci && npm run build`,
  `npm start`, healthcheck `/api/health`). Conviene montar un volumen en `/app/server/cache`.
- Es una PWA: en el móvil puede quedarse en caché la versión anterior; hay que cerrarla del
  todo o recargar dos veces después de desplegar.
- Objetivo de Rubén: tenerla en producción y que se use como usuario final de la forma más
  natural posible, sobre todo desde el móvil.

## 2. Cómo trabajar con Rubén

**Idioma y tono**
- Escribe en castellano y quiere las respuestas en castellano, claras y sin jerga.
- Contrasta la app en la calle: cuando dice que algo está mal, suele haberlo comprobado en
  persona. Hay que reproducirlo con datos en vivo, no discutirlo de memoria.

**Commits**
- Un commit por cada tarea terminada, con prefijo convencional `feat:` o `fix:` (o `docs:`),
  mensaje en castellano que cuente qué pasaba y qué cambia.
- Todos los commits terminan con:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Hacer stage solo de los cambios propios: el árbol de trabajo puede tener cambios suyos
  o de otra sesión sin revisar.
- Push a `origin/master` cuando lo pide. En la práctica casi siempre lo quiere: el despliegue
  sale de master y lo prueba en el móvil. Antes del push, `git pull --rebase`.
- Antes de commit: `npm test` y `npm run typecheck` deben pasar. Añadir pruebas que fallen
  sin el arreglo.

**Forma de trabajar que le gusta**
- Medir antes y después con datos reales (scripts de monitor) y dar las cifras.
- Comprobar en la app en marcha (servidor de desarrollo y navegador), no solo con pruebas.
- Capturas con vehículos circulando, nunca de zonas vacías.
- Para trabajos grandes o en paralelo pide abrir «hilos» (sesiones aparte), cada una en su
  propio worktree, que suben a master al terminar.
- Textos de la interfaz: cortos, lo mínimo necesario. Los segundos, claros («GPS hace 34 s»).

**Decisiones de producto que ya ha tomado**
- «Llegando» o «Ahora» en una parada significa que el vehículo está junto a esa parada. Si el
  operador da un bus por llegando, el mapa lo dibuja cerca de ella.
- No se modela la parada de los autobuses en cada parada («Déjalo como está»).
- Las paradas de tranvía y de autobús a cada lado de la calle se muestran separadas por
  sentido. Las estaciones de tren, metro y funicular muestran los dos sentidos juntos.
- Libreas reales de cada flota, independientes del color de la línea:
  - Bilbobus rojo.
  - Bizkaibus blanco con verde.
  - Metro Bilbao gris con toques naranjas.
  - Euskotren blanco con mucho azul, que recuerde a los trenes históricos.
  - Tranvía blanco con verde.
  - Renfe Cercanías blanco con rojo.
- Número real de coches: el metro con 4 o 5 coches según la unidad (las unidades 551–563 y
  601–609 llevan 5), el tranvía con 3 o 5 módulos.

## 3. Cómo está hecha

**Pila:** TypeScript en todo. Servidor Node (≥ 22.15) con Express 5. Navegador con MapLibre GL
para el mapa y Three.js para los modelos 3D. Vite para compilar. Pruebas con `tsx --test`
(sin red).

**Carpetas**
- `server/`: API, adaptadores de operadores, motor de posiciones, scripts de auditoría.
  - `server/cities/es-bilbao/`: Euskadi entera (el id dice Bilbao, pero cubre todo). Fuentes,
    libreas y composiciones (`providers.ts`), y los JSON de infraestructura: túneles, corredores,
    vías de tranvía, tramos rutados y extensiones de forma.
  - `server/cities/folderPackage.ts`, `packageConfig.ts`, `extensionRegistry.ts`: ciudades por
    carpeta.
  - `server/cities/es-madrid/`: código propio de Madrid.
  - `server/providers/`: adaptadores. Bizkaibus (tiempos de paso oficiales), Bilbobus (SIRI),
    Madrid (Metro por teleindicadores, EMT, Renfe con viajes añadidos), GTFS estático y GTFS-RT
    genéricos.
  - `server/transit/`: núcleo. `network.ts` construye vehículos, paneles de parada y fichas de
    viaje. También `officialPosition.ts`, `stopForecasts.ts`, `sameSpotStops.ts`,
    `trackMatching.ts`, `routedSegments.ts`, `tunnelGeometry.ts`, `realtime.ts`, `plans.ts`…
- `src/`: navegador.
  - `app.ts` y `ui.ts`: interfaz, ficha, paneles y textos.
  - `src/transit/`: movimiento. `gpsMotion.ts`, `timelineMotion.ts`, `motion.ts`,
    `favorites.ts`, `cities.ts`, `client.ts`.
  - `src/map/`: dibujo. `transitRenderer.ts`, `networkMap.ts` (iconos 2D), `vehicleModels.ts`
    y `vehicleShapes.ts` (modelos 3D), `vehicleLod.ts`, `followCamera.ts`, `zenMode.ts`.
- `shared/transit/`: contratos comunes entre servidor y navegador (`contracts.ts`,
  `network.ts`, `appearance.ts`, `freshness.ts`, `ids.ts`).
- `city-packages/<id>/city.json`: ciudades declarativas (Madrid, Málaga, Navarra, València).
- `docs/`: documentación técnica (ver sección 10).

**Flujo**
1. Cada operador tiene un adaptador que descarga su GTFS y sus datos en directo (GTFS-RT, SIRI,
   XML o JSON) y los traduce a un modelo común.
2. El servidor decide para cada vehículo dónde está y su línea de tiempo (anclas de progreso a
   lo largo de la forma).
3. El navegador consulta `/api/transit` cada 15 s y anima entre lecturas.

**Calidad de la posición**
- `positionSource`: `GPS`, `PROVIDER_ESTIMATED`, `INTERPOLATED_REALTIME`, `SCHEDULE_SIMULATION`
  o `STALE`.
- Se muestra como tres niveles: **Tiempo real**, **Aproximado** y **Horario**.
- Un dato en directo con más de **270 s** se descarta y se vuelve al horario.
- Un GPS con más de 45 s pasa de «live» a «predicted».

**Motor de movimiento** (`docs/motion-engine.md`)
- GPS: el vehículo avanza a su ritmo observado (últimos 4 minutos). Si se desvía más de 800 m,
  salta en vez de perseguir.
- Líneas de tiempo: se mezclan suavemente al llegar una nueva, sin retrocesos.
- La orientación se calcula con la cuerda de la forma, no con el último segmento.

## 4. Operadores de Euskadi y cómo se tratan

| Operador | Dato en directo | Notas |
|---|---|---|
| **Bizkaibus** | GPS cada ~60 s, con 1–2 min de antigüedad; tiempos de paso oficiales de la Diputación (TQWS: minutos y metros, casi sin retraso) | Ver detalle debajo de la tabla |
| **Bilbobus** | GPS cada ~20 s (API JSON por línea) y SIRI con previsiones por parada | SIRI también lista el siguiente viaje del mismo bus: hay que descartar esas filas. El mapa y el panel ya lo hacían; la ficha se arregló en `0b885ec` |
| **Metro Bilbao** | GTFS-RT TripUpdates (solo llegadas). Se publica cada 2 min exactos y llega con 1–3 min de antigüedad | Renumera sus viajes (arreglado en `21f6215`). El panel cuenta hasta la llegada y dice «Ahora» con el tren en el andén (`8178bca`) |
| **Euskotren** | GTFS-RT TripUpdates (tren, L3, tranvías de Bilbao y Vitoria) | Publica cada andén como parada distinta (Q1/Q2 bajo una StopPlace) |
| **Renfe Cercanías** | GPS de cada tren | Cerca de Bilbao, túneles importados de OSM |
| **Funicular, Puente Colgante, municipales** | Horario | |
| **Dbus, Tuvisa** | GPS | |
| **Lurraldebus, Alavabus, La Unión** | Horario | Las formas de La Unión tenían rectas de decenas de km: se rutan por carretera con OSRM (`routed-segments.json`) |

En total son 34 fuentes abiertas (Moveuskadi, Diputación de Bizkaia, Ayuntamiento de Bilbao,
Renfe…). Todo en `docs/data-sources.md`.

**Bizkaibus en detalle**
- Los tiempos de paso se emparejan con cada bus teniendo en cuenta el retraso: velocidad
  típica 8 m/s, rápida 30 m/s, y sin contar la cabecera.
- La cabecera de llegada no se confunde con la de salida (arreglo del 3517).
- Con «Llegando», el bus se dibuja junto a la parada (`officialPosition.ts`). Era típico en los
  túneles de Artxanda.
- La ficha y la posición siguen al panel oficial: el GPS es la observación y la lectura
  oficial pone el techo y el suelo del dibujo (`fb6492a`).
- Mediciones en `docs/bus-accuracy.md`.

**Paneles de estación** (`server/transit/sameSpotStops.ts`)
- Se juntan las paradas a menos de 30 m que salen en el mismo sentido.
- Los andenes de una misma estación de tren, metro o funicular (mismo operador, mismo nombre,
  ≤ 150 m) se juntan siempre.

## 5. Geometría, túneles y vehículos

**Arreglos de formas** (`docs/shape-repairs.md`)
- Los datos de OSM se importan una vez con scripts `server/import-*.ts` a partir de una
  respuesta de Overpass guardada; la app nunca llama a Overpass.
- Corredor Sondika – Ola – Matiko por el túnel de Artxanda (E3), en `rail-corridors.json`.
- Vías de tranvía de Bilbao y Vitoria (`tram-tracks.json`): las formas se encajan sobre ellas
  con `trackMatching.ts`.
- L3 Matiko – Kukullaga sobre sus vías de OSM, con las estaciones en el andén (`fa361e6`).
- Tramos rutados por carretera (OSRM) para autobuses con rectas largas.

**Túneles**
- Archivos: `metro-tunnels.json` (bocas reales de OSM), `euskotren-tunnels.json` y
  `renfe-tunnels.json`; documentados en `docs/euskotren-tunnels.md`.
- El tren entra por la boca coche a coche y la parte enterrada se vuelve transparente poco a
  poco (`fc6bc37`).
- Bajo tierra se dibuja entero (`319a880`).

**Circulación**
- Metro Bilbao, Euskotren (incluida la L3) y Metro de Madrid van por la izquierda (`b9ffa1c`).
- Renfe y los tranvías van por la derecha. Puede que Adif también circule por la izquierda en el
  norte; no está comprobado.
- Los trenes que dan media vuelta en un fondo de saco (Sondika) no se pliegan (`fab9c98`).

**Modelos**
- 3D (`vehicleModels.ts`, `vehicleShapes.ts`): forma de cada serie y librea visible de lejos
  (`VehicleLivery { body, accent, front?, band?: 'skirt' | 'broad' | 'thin' }`). Se usan
  InstancedMesh por tipo y franja, creados la primera vez que hacen falta.
- 2D (`networkMap.ts`): iconos con cabinas, puertas y pantógrafos de cada flota.
- Selección (`TransitRenderer.vehicleAt`): se puede tocar el vehículo por todo el cuerpo, que
  en los trenes facilita mucho seleccionarlos.

## 6. Interfaz

- Buscador de líneas, paradas y estaciones; filtros por modo y por operador (Capas).
- Ficha del vehículo: destino, siguiente parada, cuánto falta y de dónde sale la posición
  («GPS hace 34 s», «Sin GPS · previsión hace 72 s», «Sin datos en tiempo real»).
- Móvil:
  - Mapa a pantalla completa y ficha compacta que se despliega deslizando.
  - Seguir un vehículo con un toque.
  - Controles táctiles de al menos 44 px y letra mínima de 11 px (`abae814`, `38d5639`).
- Modo zen (tecla Z, botón del loto o desde Capas): oculta etiquetas e interfaz. Funciona
  también con un vehículo seleccionado, siguiéndolo sin ficha (`73f8f66`).
- Favoritos, botón de ubicación (solo centra el mapa), tema claro y oscuro, selector de ciudad.
- `/admin`: consola de administración, con token `TRANSIT_ADMIN_TOKEN`.
- `/debug` o `?debug`: inspector de posiciones de un vehículo.

## 7. Otras ciudades

- **Integrada en código:** Euskadi (`es-bilbao`).
- **Por carpeta:** `city-packages/<id>/city.json`.
  - Contiene GTFS obligatorio, GTFS-RT opcional y filtro `routeIds` para feeds nacionales.
  - Se valida con `npm run cities:check`.
  - Se descarga solo cuando alguien abre la ciudad, salvo `TRANSIT_WARM_CITY`.
  - Kit para generarlas desde un chat: `docs/city-package-kit/`.
- **Código propio por operador:** `extensionRegistry.ts`, como hace Madrid.
- **Lo que no tienen las ciudades por carpeta:** túneles, lugares en el buscador, libreas
  reales (salvo `appearance` en el JSON) ni arreglos de formas.
- `docs/city-packages.md` está desactualizado: dice que no hay ninguna ciudad real.

**Madrid** (`city-packages/es-madrid/data-sources.md`, medido el 16 de octubre)

| Operador | Cómo funciona | Estado |
|---|---|---|
| Metro y Metro Ligero ML1 | Posición estimada desde los teleindicadores (XML cada 30 s, minutos por andén); un tren se dibuja cuando cuadran dos estaciones seguidas | El GTFS del Metro caducó el 27/05/2026 y solo sirve de topología. Identidad estable entre estaciones (`b0d5ac2`); arreglada la L1 que desaparecía de 0:00 a 1:00 |
| Cercanías | GPS de Renfe | Una de cada tres publicaciones viene sin trenes de Madrid y ahora se ignora. Servidor a 0–147 m del GPS. **Pendiente:** el navegador dibuja a ~1 km porque el feed avanza a saltos; habría que modelarlo con TripUpdates como el Metro |
| EMT | Llegadas de MobilityLabs (credenciales `EMT_CLIENT_ID` / `EMT_PASSKEY`) | Sus coordenadas se refrescan cada ~4 min y no se usan. Los buses que llegan a paradas consultadas toman el retraso de la EMT (~60 de 1.555). Cuota: 250.000 llamadas/día, compartida con Railway |
| CRTM urbanos e interurbanos, ML2–ML4 | Horario | No hay feed abierto |

Scripts de Madrid: `npm run monitor:madrid`, `npm run replay:metro-madrid` y
`npm run audit:madrid`.

## 8. Ponerla en marcha y herramientas

```bash
npm install
npm run dev          # API en 3001 y web en 5173 (Vite pasa /api a la API)
npm test             # pruebas del servidor y del navegador, sin red
npm run typecheck
npm run build && npm start   # versión de producción en http://localhost:3001
```

- La primera carga descarga los horarios de todos los operadores (uno o dos minutos). La caché
  en `server/cache` ocupa unos 4,4 GB.
- La API refresca cada feed solo cuando alguien la consulta. La primera petición tras un rato
  sin uso puede mostrar datos caducados durante unos segundos.
- En la app de escritorio de Claude hay `.claude/launch.json` con la configuración
  `transit-dev`, que arranca el servidor de desarrollo para el navegador integrado.
- `server/dev-api.mjs` reinicia la API al cambiar archivos del servidor.

**Variables de entorno** (solo nombres; los valores van en `.env`, ignorado por Git, y en
Railway):
- `PORT`
- `TRANSIT_ADMIN_TOKEN`
- `EMT_CLIENT_ID`, `EMT_PASSKEY`
- `NAP_API_KEY`
- `TRANSIT_WARM_CITY`
- `TRANSIT_DISABLED_PROVIDERS`
- `TRANSIT_PROFILE`
- `CHROME` (para las capturas)

**Scripts con datos en vivo** (con la app en marcha):
- `npm run audit:euskadi-realtime`: estado y antigüedad de cada fuente.
- `node --use-system-ca --import tsx server/monitor-bus-accuracy.ts 25 salida.jsonl`: distancia
  entre el bus dibujado y su GPS.
- `node --use-system-ca --import tsx server/monitor-arriving.ts 10`: comprueba que un bus
  «Llegando» se dibuja junto a su parada.
- `node --import tsx server/capture-screenshots.ts [url] [escena.jpg,…]`: regenera las
  capturas del README con Chrome sin ventana. Espera a que haya más de 500 vehículos.
- `/api/providers/health?cityId=…`, `/api/transit?cityId=…`,
  `/api/stops/<operador>/<parada>?cityId=…`, `/api/trips/<operador>/<viaje>?date=…&vehicleId=…`

**Detalles de Windows**
- Usar `node --use-system-ca` para las fuentes HTTPS.
- Los heredocs de Python muy largos se cortan: mejor escribir el script a un archivo.
- Git avisa de LF/CRLF; es inofensivo.

## 9. Historia reciente (octubre y noviembre de 2026)

- **Bizkaibus y Bilbobus:**
  - Llegada a cabecera.
  - «Llegando» junto a la parada.
  - Ficha y posición coherentes con el panel oficial.
  - Precisión del GPS: textos cortos y bus que no desaparece.
  - Se deshizo el SIRI de toda la flota de Bilbobus (`288b0c8`).
  - La ficha descarta la siguiente vuelta (`0b885ec`).
- **Metro y Euskotren:**
  - Vuelta al tiempo real pese a renumerar viajes.
  - `/admin` explica los TripUpdates descartados.
  - Estaciones con los dos sentidos.
  - «Ahora» en el andén.
  - Bocas reales de los túneles.
  - L3 sobre sus vías.
- **Aspecto:** libreas reales, formas por serie, iconos 2D por flota, entrada en túneles,
  trenes enteros bajo tierra, circulación por la izquierda.
- **Interfaz:** ficha compacta en el móvil, hitbox de trenes, modo zen, seguir con un toque,
  limpieza de la interfaz.
- **Documentación:** README para usuarios con capturas. El PR 3 de Roberto se cerró porque sus
  commits ya estaban en master; el de rendimiento es `e8ec486`.
- **Madrid:** Metro estable, EMT con llegadas, Cercanías sin volver al horario, scripts de
  medición.

## 10. Pendiente y abierto

**Para llegar a producción** (prioridades que propuse y Rubén no ha descartado)
1. Fiabilidad:
   - Que un despliegue o un reinicio nunca deje el mapa vacío (arranque en frío de minutos,
     volumen de caché en Railway).
   - Aviso discreto cuando una fuente falla.
   - Registro de errores del navegador y aviso si la web se cae.
   - Caché corta delante de `/api/transit`.
2. «Paradas cerca de mí» con favoritos arriba. Hoy el botón de ubicación solo centra el mapa.
3. Avisos e incidencias de los operadores (alertas GTFS-RT): no se muestran en ningún sitio.
4. Euskera, y algo de inglés. La app está solo en castellano.
5. Peso en el móvil: unos 550 KB comprimidos de JavaScript más el motor del mapa; cargar el 3D
   solo al acercarse.
6. Dominio propio, página «Acerca de» con privacidad y licencias de los datos.

**Técnico**
- **Bizkaibus:** falta medir la versión final de la coherencia ficha/panel frente a la anterior.
  El hilo dejó dos preguntas a Rubén: si veía el problema de Bilbobus en la versión desplegada o
  en local, y un ejemplo concreto.
- **Bilbobus:** sospechas por confirmar con datos.
  - `DistanceFromStop` del SIRI a veces no cuadra con la hora.
  - El arrastre del retraso (`5790521`) podría propagar una hora de la siguiente vuelta.
- **Madrid Cercanías:** el navegador dibuja los trenes a ~1 km de la posición del servidor;
  falta modelarlos con TripUpdates. La hora punta de Madrid está sin medir: repetir
  `monitor:madrid` entre las 18 y las 20 h.
- **Cruces:** los de dos tranvías o dos metros no se han visto en directo tras el cambio de lado.
- **Renfe:** comprobar si debería circular por la izquierda.
- **Documentación:** actualizar `docs/city-packages.md`.

**Seguridad:** la passkey de la EMT y la clave del NAP aparecieron en una captura pegada en un
chat. Conviene regenerarlas y actualizarlas en Railway y en el `.env`.

## 11. Documentación del repositorio

| Archivo | Qué contiene |
|---|---|
| `README.md` | Para usuarios, con capturas en `docs/screenshots/` |
| `docs/technical-overview.md` | Notas técnicas generales |
| `docs/architecture.md` | Núcleo modular, contratos, API |
| `docs/motion-engine.md`, `docs/visual-motion.md` | Movimiento |
| `docs/data-sources.md`, `docs/source-discovery.md`, `docs/nap-audit-2026-10-03.md` | Fuentes |
| `docs/bus-accuracy.md` | Mediciones de precisión de autobuses |
| `docs/shape-repairs.md`, `docs/euskotren-tunnels.md` | Geometría |
| `docs/city-packages.md`, `docs/city-package-kit/` | Otras ciudades |
| `docs/admin-console.md`, `docs/debugging.md`, `docs/performance.md`, `docs/validation.md`, `docs/frontend.md`, `docs/modular-core.md` | Resto de temas |
| `docs/V1_SPEC.md` | Especificación original |
