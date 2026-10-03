# Transit 3D — València y núcleo urbano

## Estado

**PENDIENTE DE VALIDACIÓN BINARIA FINAL.**

Este paquete respeta estructuralmente el contrato de Transit 3D y selecciona fuentes
oficiales/estables, pero en esta sesión no se pudieron guardar y abrir localmente los
ZIP GTFS ni los protobuf GTFS-RT. Por tanto **no se declara el paquete como
“verificado” ni “listo para producción”**.

Sí se pudo comprobar en fuentes oficiales y catálogos actuales:

- EMT València: GTFS estático vigente en NAP (dataset 965, fichero 1166).
- Metrovalencia/FGV: GTFS estático vigente en NAP (dataset 967, fichero 1168).
- Cercanías Renfe: GTFS estático nacional en NAP (dataset 929, fichero 1130),
  acotado a València mediante `routeIds`.
- Renfe GTFS-RT: endpoints públicos oficiales de TripUpdates y VehiclePositions.
  El JSON oficial equivalente estaba activo durante la consulta y contenía
  entidades del núcleo 40 (València).

No se han añadido capacidades realtime a EMT ni Metrovalencia porque no se verificó
un GTFS-RT protobuf público compatible con el contrato.

## Alcance integrado

1. **EMT València** — autobús urbano, horario GTFS.
2. **Metrovalencia (FGV)** — metro y tranvía, horario GTFS.
3. **Cercanías València (Renfe)** — C1, C2, C3, C5 y C6, con GTFS-RT oficial
   configurado; el feed nacional queda filtrado por `routeIds`.

El paquete **no integra el GTFS interurbano general de la Generalitat Valenciana**
(dataset NAP 1325) porque la propia ficha pública indica que excluye las concesiones
de la Autoritat de Transport Metropolità de València. Por tanto no es una fuente
suficiente para representar MetroBus del núcleo metropolitano.

## Realtime y significado de la posición

- **EMT València:** sin realtime compatible declarado. Transit 3D usará
  `SCHEDULE_SIMULATION`.
- **Metrovalencia:** sin realtime compatible declarado. Transit 3D usará
  `SCHEDULE_SIMULATION`.
- **Renfe VehiclePositions:** la fuente oficial se describe como posición GPS real
  y estado del vehículo. Es la fuente de posición realtime.
- **Renfe TripUpdates:** actualizaciones/predicciones de viaje (retrasos,
  cancelaciones, cambios de hora, etc.). No son GPS y, si se usan para posicionar
  un vehículo, representan estimación.

## Route IDs de Cercanías València

Se han incluido IDs GTFS, no nombres cortos:

- C1: `40T0001C1`, `40T0002C1`
- C2: `40T0005C2`, `40T0006C2`, `40T0049C2`, `40T0053C2`
- C3: `40T0025C3`, `40T0026C3`, `40T0043C3`, `40T0044C3`
- C5: `40T0057C5`, `40T0063C5`
- C6: `40T0013C6`, `40T0014C6`

Los IDs adicionales C6 que corresponden al tramo Castelló–Vinaròs no se incluyen,
para no ampliar el paquete fuera del núcleo solicitado.

## Qué falta antes de considerarlo verificado

Hay que descargar físicamente los tres GTFS seleccionados y los dos protobuf de
Renfe y comprobar:

1. SHA-256 y tamaño real descargado.
2. ZIP GTFS con tablas en raíz.
3. `agency_timezone=Europe/Madrid` o equivalencia correcta.
4. `calendar.txt`/`calendar_dates.txt` vigentes en la fecha de prueba.
5. `routes`, `trips`, `stops`, `stop_times`, `shapes` y geometría en ambos sentidos.
6. Que todos los `routeIds` de Renfe existan en la versión descargada.
7. Que una muestra de `trip_id` de ambos GTFS-RT exista exactamente en `trips.txt`.
8. Timestamps originales de cabecera/entidad de los protobuf y antigüedad.
9. Que las sustituciones por autobús actuales de C2/C3/C5 no exijan ajustar el
   alcance o la presentación.

Hasta completar esas comprobaciones, el paquete debe tratarse como **candidato
pendiente**, aunque las fuentes configuradas sean oficiales.

## Instalación cuando quieras probarlo

Extrae el ZIP y copia la carpeta `es-valencia` a `city-packages/`.

Para los descriptores NAP de API 2, el servidor necesita su `NAP_API_KEY` en el
entorno. La clave no está ni debe estar dentro de este paquete.

Después:

```powershell
npm run cities:check
```

y reinicia el servidor.

`cities:check` valida la configuración, pero no sustituye la auditoría de los feeds.
