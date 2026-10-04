# Rendimiento y despliegue web

## Carga y caché

El shell y los assets con hash se sirven por separado: los assets son inmutables y
el HTML se revalida. La API conserva `no-store` para vehículos, salud y llegadas.
Los manifiestos y un catálogo completo permiten caché HTTP con ETag; mientras haya
providers preparándose o no disponibles, `/api/network` exige revalidación para
que la recuperación aparezca sin esperar una caché larga. Las respuestas mayores
de 1 KB se comprimen si el cliente anuncia gzip o Brotli.

El navegador vuelve a pedir el catálogo cada cinco segundos mientras se prepara,
pero espera un minuto ante un provider no disponible. Los snapshots continúan
cada quince segundos y se detienen cuando la pestaña está oculta. Las peticiones
de detalle tienen un timeout corto y se cancelan al cambiar de selección.

## Preferencias locales

Cada ciudad guarda por separado modo, operadores, capas, túneles y cámara. Los
valores se validan al leerlos y nunca forman parte del paquete de ciudad ni del
servidor. Tema y favoritos conservan sus claves existentes.

## Producción

`railway.toml` construye y arranca el mismo servidor Node que entrega frontend y
API. `/api/health` es un liveness local: no consulta Bizkaibus ni otro servicio
externo. La salud detallada de providers sigue en `/api/providers/health`.

Configurar secretos en las variables del servicio. Para evitar reconstruir los
GTFS tras cada despliegue, montar almacenamiento persistente en
`/app/server/cache`. Opcionalmente, `TRANSIT_WARM_CITY=es-bilbao` prepara una
ciudad en segundo plano después de que el servidor ya esté escuchando.

Los datos en directo nunca se guardan como si fueran observaciones nuevas. La
caché web no cambia `sourceTimestamp`, `receivedTimestamp` ni `positionSource`.

## Diagnóstico

`TRANSIT_PROFILE=1` registra duración y número de vehículos por provider. Para
una línea base reproducible se usan `npm run typecheck`, `npm test`,
`npm run cities:check` y `npm run build`; las pruebas normales no usan Internet.
