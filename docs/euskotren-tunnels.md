# Túneles Euskotren

## Cambio

El renderer ya interpretaba `Shape.underground` para Metro. Euskotren ahora
recibe esos rangos desde el hook de infraestructura del paquete Bilbao.
Se mantiene profundidad visual aproximada 12 m, transparencia y rampas existentes.
No cambian frontend, LOD, composiciones, movimiento ni datos realtime.

Geometrías verificadas: 201 ways / 2.426 puntos OSM de túneles ETS activos.
El archivo `server/cities/es-bilbao/euskotren-tunnels.json` conserva fuente,
licencia ODbL, timestamp, consulta e IDs. Se sirve indirectamente como rangos
GTFS, sin reemplazar trazados del operador ni incorporar OSM al bundle cliente.

## Correspondencia

`server/transit/tunnelGeometry.ts` usa celdas de 200 m y muestreo de GTFS
a pasos de como máximo 10 m. Una coincidencia inicial requiere distancia
máxima 25 m y tangente compatible (30 grados, ambos sentidos).

OSM divide túneles en ways. Los nodos compartidos identifican componentes
continuos. Un hueco de correspondencia puede cerrarse dentro del mismo
componente si su geometría queda a menos de 250 m y no vuelve al mismo portal.
Esto resuelve las desviaciones observadas de GTFS respecto al eje OSM de L3,
sin ampliar la detección inicial a cualquier vía cercana. Se conservan huecos
entre túneles desconectados y trayectos por superficie.

Los resultados se cachean por identidad de ShapeMetric. El cálculo se realiza
al preparar geometrías, nunca en cada frame ni durante cada actualización GPS.
Solo se aplica a formas ferroviarias Euskotren, sin condicionar por nombre de línea.
Metro conserva su configuración anterior.

L3 tiene un rango continuo desde el portal de Kukullaga hasta Matiko, en ambos
sentidos. E3 enlaza con Artxanda. E1/E2/E4 y los servicios E3a/FCC reciben sus
coincidencias respectivas. No es un inventario completo ni cotas topográficas:
un túnel ausente de OSM o con correspondencia insuficiente puede quedar sin anotar.

## Actualizar y comprobar, sin abrir la aplicación

La aplicación usa el dataset versionado, sin depender de Overpass en producción.
Para actualizarlo explícitamente desde PowerShell en la raíz del repo:

```powershell
$tunnelQuery = '[out:json][timeout:20];way["railway"~"^(rail|narrow_gauge|subway)$"]["tunnel"]["tunnel"!="no"](43.0,-3.05,43.46,-1.74);out tags geom;'
Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -UserAgent 'transit-3d/infrastructure-audit' -Method Post -Uri 'https://overpass-api.de/api/interpreter' -Body @{data=$tunnelQuery} -OutFile server/cache/euskotren/tunnels-osm.raw.json
npx tsx server/import-rail-tunnels.ts euskotren server/cache/euskotren/tunnels-osm.raw.json
npx tsx server/test-euskotren-tunnels.ts
npm test
npm run build
```

Revisar el diff del dataset antes de conservar una actualización. Una respuesta
parcial/vacía o con coordenadas inválidas no sustituye el dataset. El checker
necesita los archivos GTFS cacheados; no descarga feeds ni inicia servidor.

## Pruebas manuales del usuario

- Reiniciar backend y recargar web: geometrías ya pedidas quedan cacheadas en
  navegador/servidor hasta reiniciar. L3/E3 deben bajar bajo el mapa y volver
  a superficie en portales, sin emerger entre estaciones del túnel común.
- Cambiar zoom 11/14/16: mismos modelos/detalle anteriores; ningún icono
  superpuesto al modelo, ni pérdida persistente del 3D al acercar.
- Comprobar E1/E2/E4 en tramos de superficie y túneles, en ambos sentidos.
  Tranvía no debe heredar soterramiento ferroviario.
- Bizkaibus: durante 2–3 timestamps GPS distintos, mismo avance suave y
  edad real del GPS. Esta integración no debe cambiarlo.
- Si un tren emerge dentro del túnel o se hunde en superficie: enviar línea,
  estación aproximada y `/?debug=1` (trip, shape, progress, LOD, fallback).
  Para movimiento, incluir source/received timestamps, motion y mensajes
  `[transit-motion]` de consola.

## Cercanías (Renfe)

`server/cities/es-bilbao/renfe-tunnels.json` aplica el mismo emparejamiento a las
formas ferroviarias de Renfe: túneles OSM de Adif en ancho ibérico (C1–C3 de
Bilbao, C1 de Donostia) y en ancho métrico (antigua FEVE, C4/C5). Se generan con
`npx tsx server/import-rail-tunnels.ts renfe <respuesta-overpass.json>` y la
consulta que figura en el propio fichero. Auditoría 14 oct 2026: 133 ways; la C1
y la C2 bajan en Abando y recorren unos 2,3 km soterradas hacia Zabalburu y
Ametzola, y la C4 sale de Concordia con 3,5 km de túnel.

## Metro Bilbao

Antes se marcaba soterrado cada tramo entre dos estaciones de una lista, de andén a
andén, así que los portales caían siempre en una estación (un tren salía a la
superficie en Sestao o San Inazio). Ahora `server/cities/es-bilbao/metro-tunnels.json`
(71 ways `railway=subway` + `tunnel=yes` de ETS; `npx tsx server/import-rail-tunnels.ts
metro-bilbao <respuesta-overpass.json>`) da los portales reales. Auditoría 15 oct 2026:

- Bolueta está en superficie: la boca queda 124 m al oeste; entre Etxebarri y Bolueta
  hay además un túnel corto de unos 200 m.
- San Inazio: el túnel sigue unos 600 m hacia Lutxana; Gurutzeta, Ansio, Barakaldo y
  Bagatza, en túnel continuo hasta unos 315 m antes de Urbinaga.
- Urbinaga, en abierto entre dos bocas; la de Sestao, unos 350 m después.
- L2: túnel desde unos 690 m pasado Etxebarri hasta Ariz y Basauri.
- L1 en Getxo/Uribe Kosta: tramos cubiertos en Erandio, Areeta, Algorta, Bidezabal,
  Ibarbengoa, Urduliz y Plentzia.

La lista de estaciones subterráneas queda solo para cerrar huecos: algunas formas
GTFS (Ansio–Basauri) están redondeadas a 100 m y pierden el eje del túnel en Casco
Viejo; un hueco cuyos dos extremos caen entre estaciones subterráneas no sale a la
superficie.

Una forma que empieza o acaba dentro de un túnel indica si el túnel sigue más allá
(`tunnelBeforeStart` / `tunnelAfterEnd`): a más de 100 m de una boca OSM es una
terminal subterránea (Matiko, Kabiezes, San Inazio, Durango, Casco Viejo); si no,
la forma arranca en la boca (Concordia, Lezama, Irun).
