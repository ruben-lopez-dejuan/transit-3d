# Pamplona y Navarra — Transit 3D

Estado: **paquete final de integración estática para Transit 3D**. Los feeds se configuran mediante NAP API 2; la validación binaria de sus contenidos actuales queda documentada como no realizada en esta sesión.

Este paquete respeta la API 2 del contrato de carpetas de Transit 3D y no contiene código ejecutable, dependencias, credenciales ni URLs firmadas temporales.

## Alcance integrado

- **Transporte Urbano Comarcal (TUC / TCC Pamplona)**: GTFS estático de NAP, `datasetId=976`, `fileId=1177`.
- **NBus — Transporte Interurbano de Navarra**: GTFS estático de NAP, `datasetId=963`, `fileId=1164`.
- Modo integrado: **bus**.
- Zona horaria: `Europe/Madrid`.
- No se declaran `tripUpdates` ni `vehiclePositions`: no se localizó un GTFS-RT público compatible y verificable para estos dos proveedores.

## Importante sobre la validación

Durante esta sesión se pudo verificar la existencia, vigencia y metadatos actuales de los recursos en NAP y contrastar las páginas oficiales, pero el entorno no permitió recuperar los ZIP binarios de NAP ni el ZIP directo de Datos Abiertos de Navarra. Por tanto, **no se declaran como verificados** SHA-256, contenido completo de tablas, correspondencia parada-shape, ambos sentidos ni calendario efectivo del archivo actual.

La web oficial de Tu Villavesa ofrece ubicación y tiempos en tiempo real, pero no se encontró un endpoint público GTFS-RT documentado. Transit 3D no debe tratar esa capa web/CIT como `vehiclePositions` o `tripUpdates` sin un adaptador específico.

## Fuentes nacionales excluidas

RENFE y ALSA no se incluyen. Son feeds nacionales/multirregionales y el contrato exige `routeIds` exactos para acotarlos. Sin acceso al GTFS actual no es seguro inferir esos IDs desde nombres de línea, estaciones o servicios; hacerlo podría incorporar rutas de otras ciudades.

## Instalación

1. Extrae el ZIP.
2. Copia la carpeta `es-navarra/` dentro de `city-packages/`.
3. Configura `NAP_API_KEY` únicamente en el entorno del servidor si todavía no está configurada.
4. Ejecuta `npm run cities:check`.
5. Reinicia el servidor.

`cities:check` valida la configuración del paquete, pero no certifica los feeds remotos.

## Qué esperar en la aplicación

Hasta disponer de realtime compatible, ambos proveedores funcionarán como **SCHEDULE_SIMULATION** a partir del GTFS estático. No debe mostrarse como GPS real ni como predicción de llegada en tiempo real.

## Validación adicional opcional

Facilita los ZIP GTFS descargados actualmente de NAP para los ficheros 1177 y 1164, o permite una descarga autenticada de NAP. Con esos binarios se deben comprobar: estructura raíz, `agency_timezone`, `calendar/calendar_dates`, rutas/trips/paradas/shapes, sentidos, coherencia shape-stop, vigencia real y hashes SHA-256.
