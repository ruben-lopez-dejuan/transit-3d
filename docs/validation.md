# Validación de la entrega

## Selector y paquetes de ciudades

**3 de octubre de 2026.** `npm test`: **101 tests pasando**, 72 core y 29 frontend.
`npm run typecheck`, `npm run build` y `npm run cities:check` correctos.
Solo Bilbao está instalado; se prueba otra ciudad mediante un ZIP GTFS sintético
temporal, sin fuentes externas. La integración cubre filtros, catálogo, geometría,
vehículos, namespaces, timestamps y aislamiento de configuraciones inválidas.
Los tests ya no suponen que el usuario nunca añadirá carpetas de ciudades.
Modelos y LOD conservan sus hashes de build. No se abrió la aplicación ni se
realizaron pruebas manuales. Flujo de instalación, límites y lista de pruebas
para el usuario: [city-packages.md](city-packages.md).

## Túneles Euskotren

**3 de octubre de 2026.** `npm test`: **88 tests pasando**, 63 core y 25 frontend.
`npm run build`: tipos y compilación correctos; assets frontend idénticos al
paquete anterior. Siete tests nuevos de infraestructura cubren sentidos,
continuidad, curvas, exclusión de cruces/vías ajenas, superficie y tranvías.
Se corrigió una fixture del paquete modular que fallaba de madrugada porque
su parada final fija a las 24:00 quedaba fuera de la ventana de próximas salidas.

`npx tsx server/test-euskotren-tunnels.ts` comprueba el GTFS cacheado real:
32 shapes E1, 20 E2, 4 E3, 8 E4 y 2 L3 con coincidencias; ambos sentidos en
las líneas principales. L3 tiene un rango continuo por sentido. Hay cobertura
adicional E3a/FCC. No se anotan túneles en tranvías/funicular.
No se abrió la aplicación ni se observaron ciclos realtime.
Fuentes y límites: [euskotren-tunnels.md](euskotren-tunnels.md).

## Paquete posterior: núcleo modular de ciudades

**2 de octubre de 2026.** `npm test`: 81 tests pasando (56 core + 25 frontend).
`npm run typecheck` y `npm run build` correctos; aviso existente de chunks
grandes. Nuevos tests: normalización, capacidades, IDs, fechas, recepción/frescura,
fallos, desactivación, cachés, pipeline de red en memoria y favoritos.
Las comprobaciones anteriores de LOD y GPS espaciado siguen pasando.

No se abrió la aplicación, no se ejecutaron pruebas visuales/manuales ni se
esperaron ciclos reales. Los resultados de red y visuales siguientes pertenecen
a fases anteriores. Alcance, límites y lista manual del usuario:
[modular-core.md](modular-core.md).

## Paquete posterior: pulido visual y movimiento

Validado exclusivamente por código: **40 tests core y 24 frontend pasando** y
`npm run build` correcto. No se abrió la aplicación, no se realizaron pruebas
visuales ni se esperaron ciclos de feeds. Las capturas reales que aparecen
debajo corresponden a la entrega anterior. El nuevo comportamiento requiere
la revisión del usuario descrita en [visual-motion.md](visual-motion.md).

**2 de octubre de 2026**. Feeds públicos reales, API local y frontend compilado.

## Resultados

- `npm test`: **49 tests pasando**, 37 core y 12 frontend. Calendarios, excepciones,
  DST, horas extendidas, frecuencias, geometría, movimiento, TripUpdates, frescura
  GPS, Bilbobus/SIRI y reproducción de capas ocultas.
- `npm run build`: tipos y compilación correctos; avisos de bundles grandes de
  MapLibre y Three.js.
- `npm run test:network`: API real validada para **34 proveedores**, incluyendo
  catálogo, líneas, paradas, viajes, geometría, identidades, calidad y parámetros.
- Navegador: escritorio y móvil 390 × 844; búsqueda, selección, seguimiento,
  capas, etiquetas, 3D y próximas llegadas. Sin errores de consola observados.

## Varias actualizaciones reales

Primera captura: nueve snapshots durante unos 162 s. Se siguieron 143 intervalos
GPS Bizkaibus, 564 Bilbobus, 116 Renfe y 62 Tuvisa. Bizkaibus publicó intervalos
de **149 s**, ahora respetados. Un salto Renfe de 66,84 m/s motivó el rechazo
configurable que conserva la última observación válida y su antigüedad.

Después de las correcciones: seis snapshots entre 17:10:36 y 17:12:18 UTC,
con **808–864 vehículos**. El primer snapshot mostró horario mientras arrancaban
las consultas independientes; después hubo hasta 179 GPS Bizkaibus, 120 Bilbobus,
22 Renfe y 60 Tuvisa. Dbus pasó a horario al caducar. Metro, Euskotren y tranvía
permanecieron correctamente estimados.

| Operador | Intervalos comparados | Cadencia del dato | Velocidad media sobre shape |
|---|---:|---|---|
| Bilbobus, captura final | 229 | 11–60 s | −1,22 a 10,88 m/s |
| Renfe, captura final | 66 | 19–60 s | 0 a 34,61 m/s |
| Bizkaibus, captura anterior | 143 | 149 s | −0,02 a 28,09 m/s |

Los pequeños retrocesos son ruido de coordenadas/proyección, no prueba de marcha
atrás. Son velocidades medias entre observaciones, no medidas instantáneas.
Se revisaron varios buses simultáneos, Metro, Euskotren, tranvía y Cercanías.
Bilbobus aparece rojo y sus ETA SIRI cambian independientemente de la posición.
GPS se detiene sin nuevos datos; pausas del horario son estimadas. Cada coche
ferroviario sigue su tangente; separación de sentidos y profundidad son aproximadas.

Tras conservar curvas cortas, la diferencia máxima entre posición normalizada
del servidor y shape transferido fue 0,43 m Bizkaibus, 1,76 m Bilbobus, 0,008 m
Renfe y 0,14 m Euskotren. **No mide precisión GPS contra el mundo real.**

## Rendimiento observado

- Antes: catálogo frío 47,1 s; snapshots calientes 4,85–5,56 s.
- Después: catálogo con caché preparada 3,85 s; primera preparación de planes
  4,73 s; snapshots posteriores 925 y 159 ms en el perfil.
- Con navegador y diagnóstico: consultas sin caché 442–618 ms y cacheada 19 ms;
  arranque de esa captura 5,55 s.
- Preparación JavaScript del render: 0,2–2,2 ms para 1–357 vehículos visibles;
  no incluye el frame GPU completo ni garantiza FPS en teléfonos.

Caché de GTFS preparado, planes y geometrías; reutilización de formatos y fechas;
refrescos aislados; carga diferida de Three.js, instancias y descarte fuera de
pantalla. Mediciones locales concretas, no un benchmark de dispositivos físicos.

## Limitaciones y siguiente fase

- Feeds intermitentes/discretos y fallback etiquetado. Bilbobus enlaza el bus
  físico con un viaje GTFS estimado; su GPS y ETA municipal sí son observados.
- C5 Renfe tiene geometrías incompletas: horarios conservados, posiciones
  incompatibles omitidas. Sin completar vías inventadas.
- Metro: profundidad aproximada, túneles aislados L1 pendientes; material móvil
  estilizado, sin composición real por viaje.
- Medir Android físico y coste GPU sostenido.
- Fuentes vacías Bilbobus/Moveuskadi, timestamps futuros AlavaBus y errores
  Overpass: motivos y alternativas en [data-sources.md](data-sources.md).

Scripts reproducibles: `server/validate-live.ts` y `server/profile-network.ts`.
Capturas crudas locales en `server/cache`, ignorado por Git. No hubo push ni
publicación externa. La disponibilidad puntual no garantiza continuidad del feed.
