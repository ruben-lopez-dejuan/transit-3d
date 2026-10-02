# Entrega: núcleo modular de ciudades (API 1)

Actualización: el selector y la incorporación de carpetas JSON ya están disponibles.
Consulta `docs/city-packages.md` y `docs/city-package-kit/FORMAT.md` para el flujo
actual. Este documento conserva el alcance y decisiones del refactor original.

## Alcance

Bilbao se encapsula con sus proveedores actuales. No se registran ciudades nuevas.
Modelos 3D, movimiento GPS, umbrales y propiedad exclusiva del LOD se conservan.
La representación recibe metadatos del paquete de ciudad.
No se añade instalador ZIP, APK ni rediseño PWA.

Referencia: `docs/V1_SPEC.md`, prompt del núcleo modular e instrucción posterior
de no realizar pruebas visuales.

## Archivos creados

| Área | Archivos |
|---|---|
| Contratos | `shared/transit/{contracts,ids,freshness,appearance,network}.ts` |
| Registro/normalización | `server/transit/{registry,registeredProvider,normalization,cityPackage}.ts` |
| Procesamiento común | `server/transit/applyRealtime.ts` |
| Bilbao | `server/cities/es-bilbao/{city.manifest,index,sources,providers,places,infrastructure}.ts`, `server/cities/index.ts` |
| Persistencia | `src/transit/favorites.ts` |
| Tests | `server/transit/modular.test.ts`, `cityNetwork.test.ts` |
| Documentación | Este documento |

## Archivos modificados

| Área | Archivos y motivo |
|---|---|
| API/composición | `server/index.ts`, `server/providers/catalog.ts`: manifest, ciudad y compatibilidad |
| Motor/catálogo | `server/transit/{engine,network,types}.ts`: contratos, cachés por ciudad, fallos y referencias |
| Hooks Bilbao | `server/transit/{labels,infrastructure}.ts`: traslado con reexports compatibles |
| GTFS/realtime | `server/transit/{plans,scheduled,realtime}.ts`; `server/providers/{staticGtfs,realtimeFeed,realtimeProvider}.ts`: zona del paquete, recepción y delegación |
| Recepción existente | `server/providers/bilbobus.ts`, `bizkaibus/{realtime,service}.ts`: metadatos, sin alterar matching/cadencia/movimiento |
| Cliente | `src/{app,ui,pwa}.ts`, `src/transit/{client,networkTypes}.ts`: configuración recibida, IDs, favoritos |
| Representación | `src/transit/vehiclePose.ts`, `src/map/{vehicleLod,transitRenderer}.ts`: aspecto y diagnóstico de fuente dibujada |
| Tests existentes | `server/transit/{core,plans}.test.ts`, `src/transit/frontend.test.ts`, `src/map/vehicleLod.test.ts`: fixtures normalizadas y asserts anteriores conservados |
| Comprobaciones | `package.json`, `server/test-network.ts`: nuevos tests, typecheck, referencias externas |
| Documentación | `README.md`, `docs/{architecture,data-sources,validation}.md` |

Los cambios previos de dependencia `server`, lockfile, módulo legado
`src/map/vehicleAnimator.ts` y especificación sin seguimiento se conservan
fuera de estos commits.

## Qué es genérico y qué sigue siendo específico

**Genérico:** contratos/namespaces; normalización; estado/frescura; registry;
agregación; catálogo/cachés por ciudad; calendario/fechas; aplicación GPS/TU;
primitivas de matching/movimiento; cliente API; búsqueda/selección/favoritos;
pose, LOD y render.

**Bilbao:** fuentes/providers y cobertura regional existente; conversión municipal
ED50/hora civil; asociación municipal al viaje; SIRI; peculiaridades Bizkaibus;
selección/preparación Renfe; lugares, túneles aproximados, colores, composiciones
y offsets. Estas decisiones están en adapters/paquete. El frontend activo no
tiene condicionales por nombre de operador.

Un paquete futuro necesita manifest API 1, SourceAdapters envueltos, capacidades
verdaderas, catálogo y hooks opcionales. Debe usar namespace de ciudad en caché
estática y nombre de cliente realtime, y pasar zona a generadores/RealtimeProvider.

## Comprobaciones ejecutadas

**2 de octubre de 2026**, sin navegador, servidor de prueba ni red externa:

- `npm test`: **81 tests**, 56 core y 25 frontend, todos pasan.
- `npm run typecheck`: correcto.
- `npm run build`: correcto; aviso existente de chunks grandes.
- `git diff --check`: correcto para los cambios de esta entrega.

Se conservan los 64 tests anteriores y se añaden 17. Cobertura: normalización,
IDs externos difíciles, timestamps inválidos/repetidos, expiración, recepción
desconocida, capacidades, versiones, fallos/desactivación, cachés y favoritos.

El pipeline en memoria cubre catálogo, snapshots, geometrías, líneas, paradas,
viajes y llegadas de Bilbobus, Bizkaibus, Metro y Euskotren. Tests LOD comprueban
propiedad exclusiva de representación y capacidad visible. Los tres ciclos GPS
sintéticos de 149 s siguen pasando con los cálculos existentes.

Esto confirma fixtures y compilación. No acredita que los feeds respondan ahora
ni sustituye la revisión visual del usuario. No se reauditaron fuentes en esta fase.

## Reiniciar para ver esta versión

El servidor antiguo no tiene los endpoints de manifest nuevos. Detenerlo con
Ctrl+C y arrancar desde el repositorio:

```powershell
npm run build
npm start
```

Abrir `http://localhost:3001/` y recargar con Ctrl+F5.
En desarrollo: `npm run dev`, `http://localhost:5173/`.

## Pruebas manuales para el usuario

1. **Zoom/LOD:** acercar/alejar alrededor de 11, 14 y 16, centrado en Bilbao.
   Desde 11 deben aparecer volúmenes 3D; 14/16 añaden detalles conservados.
   Tras cargar modelos, una vista cercana no debe quedar en iconos planos.
2. **Duplicados:** elegir un bus y tren y alternar zoom, selección y capas.
   Cada vehículo tiene una sola representación: icono o modelo. Los coches
   ferroviarios pertenecen a una composición; no son vehículos duplicados.
3. **Bizkaibus:** observar dos o tres cambios del timestamp GPS real, no solo
   consultas HTTP. Debe avanzar/corregir suavemente, sin retrocesos, acelerones
   al recibir datos ni reiniciar la edad del GPS en cada consulta.
4. **Resto:** Bilbobus rojo; Metro, Euskotren, tranvía y Cercanías disponibles
   con filtros, curvas, selección y llegadas. Abrir favoritos, línea, parada y viaje.
5. **Aislamiento opcional:** arrancar con
   `$env:TRANSIT_DISABLED_PROVIDERS='bizkaibus'`. Solo esa fuente indisponible;
   Bilbobus/trenes continúan. Quitar con
   `Remove-Item Env:TRANSIT_DISABLED_PROVIDERS` y reiniciar al terminar.
6. **Si falla:** iconos planos persistentes cerca, icono/modelo simultáneos,
   teletransportes/velocidades absurdas o GPS siempre con edad cero indican
   regresión. Abrir `/?debug=1`, seleccionar vehículo y enviar panel: trip/shape,
   source/received timestamp, last query, motion time, rendered position source,
   LOD, fallback y motion. Incluir mensajes `[transit-motion]` de consola
   y error concreto de API si existe.

## Deuda técnica

- Parser/modelo GTFS genérico conserva ruta `providers/bizkaibus/gtfs.ts`
  y nombre `BizkaibusGtfs`. Renombrarlo/moverlo no era necesario para el desacoplamiento.
- `server/transit/types.ts` conserva alias de DTO/adapters anteriores.
  Los contratos públicos normalizados están en `shared/transit`.
- APIs antiguas Bizkaibus y módulos de cliente anteriores permanecen por
  compatibilidad. El frontend activo usa la API común.
- HTML inicial y manifest PWA conservan branding estático de Bilbao.
  Frontend activo configurable; assets/offline de manifest por ciudad pendiente.
- Adapters municipales y matching específico se encapsulan sin reescribirlos.
  El núcleo ofrece primitivas compartidas, preservando correcciones existentes.
- Se mantiene fallback honesto de horario/predicciones sin GPS externo fresco,
  geometrías imperfectas y offsets ferroviarios aproximados documentados.
- Continúan avisos MapLibre/Three. Se conserva carga diferida, instancias,
  filtrado visible y cachés; no se ha medido rendimiento visual en esta fase.
- Instalador ZIP, cambio interactivo de ciudad, otras ciudades y APK/móvil
  corresponden a fases posteriores.
