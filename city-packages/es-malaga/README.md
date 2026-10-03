# Málaga — Transit 3D API 1

Paquete de ciudad `es-malaga` preparado conforme al contrato API 1 suministrado.

## Alcance

Este paquete integra:

- **EMT Málaga** — autobús urbano, GTFS estático.
- **Metro de Málaga** — Líneas 1 y 2, GTFS estático.
- **Renfe Cercanías Málaga — C2** — Málaga-Centro Alameda ↔ Álora, ambos sentidos, GTFS estático nacional filtrado mediante `routeIds`.
- **Consorcio de Transporte Metropolitano del Área de Málaga** — 50 `route_id` exactos del GTFS unificado andaluz, acotados al núcleo metropolitano definido por el paquete.

### Cercanías C1

La **C1 Málaga-Centro Alameda ↔ Fuengirola no se incluye todavía**. En el GTFS oficial de Renfe descargado el 3 de octubre de 2026, los dos viajes principales de C1 referencian shapes orientados en sentido contrario a su secuencia de paradas:

- `32T0001C1`: Málaga-Centro Alameda → Fuengirola usa `32_C1`, cuya geometría empieza en Fuengirola y termina en Málaga.
- `32T0002C1`: Fuengirola → Málaga-Centro Alameda usa `32_C1_INV`, cuya geometría empieza en Málaga y termina en Fuengirola.

API 1 exige que el shape siga el sentido del viaje y no permite corregir ni invertir geometrías desde `city.json`. Por eso se integra **C2**, que sí pasa la comprobación geométrica, y se omite C1 en vez de mostrar trenes recorriendo la línea al revés.

### Realtime de Renfe

Se volvieron a descargar y analizar `vehicle_positions.pb` y `trip_updates.pb` durante horario diurno, aproximadamente a las **11:17 CEST del 3 de octubre de 2026**.

- `vehicle_positions.pb` era un GTFS-RT 2.0 válido pero contenía **cero entidades**.
- `trip_updates.pb` contenía solo **dos entidades especiales**, ninguna de Málaga; una de ellas correspondía a la ruta `10T0053C7` (C7 Príncipe Pío–Atocha).

Por tanto, no se declaran `vehiclePositions` ni `tripUpdates` en `city.json`: el contrato exige realtime realmente verificado y compatible con el GTFS seleccionado. La documentación oficial de Renfe describe VehiclePositions como GPS real y TripUpdates como actualizaciones de viaje, pero la muestra actual no permite validar realtime de C1/C2 Málaga.

En esta versión, todos los proveedores del paquete se representan mediante **horario estático / SCHEDULE_SIMULATION**.

## Instalación

Extrae el ZIP y copia directamente:

```text
es-malaga/
```

a:

```text
city-packages/es-malaga/
```

en la raíz de `transit-3d`.

Después ejecuta:

```powershell
cd C:\Users\ruben\transit-3d
npm run cities:check
```

y reinicia el servidor.

No hay que modificar registry, renderer, `package.json` ni código TypeScript.

## Comprobaciones recomendadas

Tras reiniciar:

1. El selector debe mostrar **Málaga**.
2. Deben aparecer EMT Málaga, Metro de Málaga, Renfe Cercanías Málaga — C2 y el Consorcio metropolitano.
3. En Renfe solo deben aparecer `32T0003C2` y `32T0004C2`; no deben aparecer rutas de otros núcleos de Cercanías.
4. C2 debe recorrer Málaga-Centro Alameda ↔ Álora en ambos sentidos.
5. Metro debe mostrar L1 y L2.
6. El proveedor CTMAM no debe arrastrar líneas de otros consorcios andaluces.

La validación realizada aquí es sobre los feeds y `city.json`. **No se ha ejecutado, compilado ni probado visualmente Transit 3D.**

## Vigencia

Las verificaciones de este paquete corresponden al **3 de octubre de 2026**.

- EMT declara servicio hasta el 30/11/2026 en la muestra analizada.
- Metro Málaga declara `feed_end_date=20261007`; el operador deberá publicar una actualización antes/después de esa fecha para mantener el servicio.
- El GTFS nacional de Cercanías analizado cubre hasta el 23/10/2026.
- CTAN indica que su GTFS unificado se actualiza diariamente.

Consulta `data-sources.md` para hashes, conteos, IDs exactos, geometría, realtime y fuentes descartadas.
