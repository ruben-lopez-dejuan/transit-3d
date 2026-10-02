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
npx tsx server/import-euskotren-tunnels.ts server/cache/euskotren/tunnels-osm.raw.json
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
