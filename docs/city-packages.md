# Selector y paquetes de ciudades

La cabecera permite elegir ciudad/núcleo. La lista procede de `/api/cities`.
Bilbao es la ciudad inicial. Una elección se guarda en `transit:city` y en
`?city=<id>`; la URL prevalece al abrir un enlace. Si el paquete deja de existir,
se usa una elección guardada válida o Bilbao. Se mantienen tema y favoritos
con IDs globales. Cambiar de núcleo recarga la página para aislar consultas
pendientes, selección, geometrías, historial de movimiento y zona horaria.

## Añadir una carpeta generada en un chat normal

1. Adjunta `docs/city-package-kit/FORMAT.md` y `city.schema.json` al chat.
2. Copia el prompt de `docs/city-package-kit/PROMPT.md`, indicando el núcleo.
3. Obtén el ZIP y extrae su carpeta. Ejemplo futuro de destino:
   `C:\Users\ruben\transit-3d\city-packages\es-malaga\city.json`.
4. Desde la raíz del repo, ejecuta `npm run cities:check`. Si falla, corrige el
   archivo/carpeta indicado. Es una comprobación de formato, no de conectividad.
5. Reinicia el proceso que sirve la API: `npm start` en producción, después de
   `npm run build`; o reinicia `npm run dev` durante desarrollo. Al incorporar
   solo JSON no necesitas recompilar el frontend si esta versión ya está construida.
6. Recarga la web y selecciona la ciudad. Comprueba disponibilidad de operadores
   en Capas y `/api/providers/health?cityId=es-malaga`.

Un chat normal necesita el contrato adjunto: no tiene acceso automático a este
directorio. Si no dispone de descarga/análisis de archivos, proporciónale los
feeds o considera su entrega pendiente de verificación. No requiere Work para
generar el paquete declarativo. No todos los chats pueden producir ZIP; también
sirve guardar los tres archivos que devuelva como texto.

## Implementación

- `server/cities/packageConfig.ts`: contrato estricto y validación semántica.
- `server/cities/folderPackage.ts`: descubre carpetas inmediatas, aísla errores,
  compone StaticGtfsProvider + RealtimeProvider + RegisteredProvider.
- `server/cities/index.ts`: registra Bilbao y después las carpetas válidas.
- `server/check-city-packages.ts`: validación local sin consultas externas.
- `src/transit/cities.ts`: elección y URL, sin operadores concretos.
- `src/transit/client.ts`: todas las consultas de red usan cityId.
- `src/app.ts`, `src/ui.ts`, `src/style.css`: arranque, selector nativo y estilos.

La identidad de caché incluye ciudad, operador y hash de configuración. Cambiar
URL/filtro no reutiliza un catálogo anterior. Los GTFS nacionales se filtran por
route_id antes de normalizar y se podan geometrías/paradas no referenciadas.
Las capacidades describen protocolos soportados; la salud indica si actualmente
hay datos utilizables. No se inventa realtime ni timestamps.

## Alcance actual

Paquetes declarativos para GTFS ZIP con geometrías útiles y GTFS-RT protobuf
FULL_DATASET. APIs particulares requieren un adaptador reusable integrado en el
core antes de poder configurarlas. Este formato no añade túneles, POI, fuentes
con autenticación, ocupación ni alertas. Bilbao conserva sus adaptadores, lugares,
túneles, modelos, umbrales LOD y pipeline GPS existentes.

No se ha implementado Málaga ni otra ciudad real. El ejemplo del kit nunca se
registra automáticamente. Un paquete válido en formato puede tener un feed
caído o desactualizado; su documentación debe aportar la verificación real.

## Comprobaciones de esta entrega

101 tests unitarios: 72 core y 29 frontend. Type-check y build correctos.
Prueba de integración con ZIP GTFS sintético local: descubrimiento, filtro,
catálogo, posición SCHEDULE_SIMULATION, timestamps, namespaces y geometría.
No se abrió la aplicación ni se hicieron pruebas visuales/ciclos de feeds.
Los chunks del LOD y de modelos mantienen sus hashes previos.

## Pruebas manuales que debe hacer el usuario

- Al reiniciar, Bilbao debe aparecer seleccionado; tras instalar otra ciudad,
  cambiarla, recargar y abrir su enlace debe conservar esa elección. No deben
  quedar líneas, vehículos o paneles de la ciudad anterior.
- Cambia zoom cerca/lejos y activa 3D: debe conservarse el LOD de la fase anterior,
  con modelos al acercar y una sola representación por vehículo. Un icono
  superpuesto al modelo o modelos que nunca aparecen indican regresión.
- Sigue un Bizkaibus durante 2–3 actualizaciones **del timestamp GPS del feed**:
  sin carreras al recibir datos ni desplazamientos hacia atrás. Consultas HTTP
  repetidas no deben renovar su GPS. Saltos o acelerones indican un problema.
- Si falla, devuelve el error de consola, URL con ciudad, zoom, LOD,
  `3D fallback`, `source timestamp`, `received timestamp`, `motion time` y el
  bloque `motion` que aparece al seleccionar el vehículo con `?debug`.
- Si no aparece una carpeta, devuelve `/api/city-packages` y la salida de
  `npm run cities:check`; si aparece sin vehículos, añade la salud del proveedor,
  fecha/hora, estado de Capas y su documentación de fuentes.
