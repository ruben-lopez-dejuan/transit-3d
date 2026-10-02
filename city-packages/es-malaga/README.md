# Málaga y núcleo metropolitano — Transit 3D API 1

Paquete de ciudad para `es-malaga`, preparado conforme al contrato API 1 suministrado.

## Alcance

El paquete integra únicamente fuentes GTFS estáticas que se pudieron inspeccionar de forma efectiva:

- **EMT Málaga**: red urbana de autobús de Málaga.
- **Metro de Málaga**: Líneas 1 y 2.
- **Consorcio de Transporte Metropolitano del Área de Málaga**: subconjunto de 50 `route_id` del GTFS unificado andaluz, acotado al núcleo metropolitano representado por los `bounds` del paquete. Se excluyen deliberadamente rutas de otros consorcios y corredores que salen hacia Marbella, Antequera, Casabermeja/Colmenar, Comares, Torre del Mar, Vélez-Málaga, Nerja, Motril, Almería, Córdoba y otros destinos externos al alcance seleccionado.

**Renfe Cercanías Málaga no se incluye en `providers` en esta versión.** El GTFS nacional analizado contiene las rutas C1/C2, pero los shapes de C1 están orientados en sentido contrario a la secuencia de paradas del viaje. API 1 no corrige automáticamente geometría invertida. Los GTFS-RT oficiales de Renfe también fueron analizados, pero la muestra aportada era nocturna y contenía cero entidades, por lo que no permitió comprobar correspondencia de `trip_id` con el GTFS estático. Los detalles están en `data-sources.md`.

No hay realtime declarado en `city.json`. Por tanto, los tres proveedores incluidos funcionan como **SCHEDULE_SIMULATION** con sus horarios GTFS. La posición pública de EMT disponible como CSV/GeoJSON no es GTFS-RT protobuf y no es compatible con API 1.

## Instalación

1. Extrae el ZIP.
2. Copia la carpeta `es-malaga/` directamente a `city-packages/` en la raíz del repositorio.
3. Desde la raíz del repositorio ejecuta:

   ```powershell
   npm run cities:check
   ```

4. Reinicia el servidor de Transit 3D.
5. Selecciona **Málaga y núcleo metropolitano** en el selector de ciudades.

No hay que modificar ningún registry, renderer, `package.json` ni código TypeScript.

## Comprobaciones recomendadas

Tras copiar el paquete, comprueba que `npm run cities:check` acepta `es-malaga` y que, después del reinicio, aparecen las capas de EMT Málaga, Metro de Málaga y autobuses metropolitanos. Comprueba también que L1/L2 de Metro aparecen como ferrocarril/metro y que el proveedor metropolitano no muestra rutas de otros consorcios andaluces.

La validación realizada para generar este paquete fue sobre los archivos de datos y sobre `city.json`; **no se ha abierto, ejecutado, compilado ni probado visualmente tu aplicación**.

## Actualización de feeds

El ZIP del paquete no contiene copias de los GTFS. El servidor descargará las URLs declaradas cuando utilice la ciudad, tal como establece API 1. Los análisis de `data-sources.md` corresponden a las muestras verificadas el **3 de octubre de 2026** y una actualización posterior del operador puede modificar calendarios, IDs o geometrías.
