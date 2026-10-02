# Arquitectura del núcleo modular

## Flujo y límites

```text
CityPackage: manifest, fuentes y configuración
  ↓
SourceAdapter: descarga, parseo y peculiaridades del proveedor
  ↓
RegisteredProvider: validación, IDs, frescura y salud
  ↓
TransitEngine: snapshots independientes y combinación
  ↓
CityNetwork: catálogo, geometrías, viajes y llegadas
  ↓
API con contratos shared/transit
  ↓
Frontend: movimiento común → pose → LOD → modelos/capas
```

Los adaptadores existentes se conservan en `server/providers`. No contienen
React, cámara, zoom, selección ni modelos 3D. La configuración de operadores
está en `server/cities/es-bilbao`; el núcleo recibe sus interfaces.
Solo se registra Bilbao. Sus 34 proveedores incluyen la cobertura regional
que ya tenía la aplicación.

## Contratos e identidades

`shared/transit/contracts.ts` define `CityPackage`, `CityManifest`,
`TransitProvider`, `ProviderCapabilities`, `NormalizedVehicle`,
`NormalizedRoute`, `NormalizedTrip`, `NormalizedStop` y `ProviderHealth`.
`CITY_PACKAGE_API_VERSION = 1` se comprueba en registro y cliente.
`shared/transit/network.ts` define las respuestas compartidas de la API.
El backend ya no importa tipos del frontend.

Las identidades internas usan `entityId(city, provider, kind, externalId)`.
Los segmentos escapados admiten IDs externos con dos puntos, porcentajes,
espacios o barras. Ruta, viaje, parada, shape, servicio, vehículo y lugar tienen
namespace. Las referencias a fuentes se conservan como `externalId`,
`externalTripId`, `externalRouteId`, `externalShapeId` y `externalVehicleId`.

El ID del servicio visible incluye la identidad anterior de fecha/viaje del
adaptador para conservar su continuidad. El vehículo físico, cuando se conoce,
tiene su propio `vehicleId` normalizado. Los joins municipales usan
`externalVehicleId`, nunca un ID global como si fuera un identificador del feed.

## Paquete de Bilbao

`server/cities/es-bilbao/city.manifest.ts` declara identidad, país, región,
zona horaria, centro, bounds, modos, providers, capacidades y presentación.

- `sources.ts`: fuentes actuales y catálogo regional.
- `providers.ts`: composición de adaptadores, TU, llegadas SIRI y aspecto.
- `places.ts`: lugares de Bilbao mediante paradas oficiales.
- `infrastructure.ts`: túneles aproximados de Metro conservados.
- `index.ts`: une manifest, providers y hooks.
- `server/cities/index.ts`: registro y ciudad por defecto.

Composiciones, tipo Metro y separación lateral C4/C5 son metadatos del paquete.
El frontend usa `appearance` y `mode`; no identifica operadores para decidir
su representación.

## Núcleo y movimiento

`ProviderRegistry` expone `getCities()`, `getCity()`,
`getProvidersForCity()` y `getProviderHealth()`. Valida versión,
zona horaria, pertenencia y duplicados. `RegisteredProvider` envuelve cada
adaptador y aísla errores: `healthy`, `degraded`, `stale`, `unavailable`.
Las capacidades describen información conectada, no garantizan frescura.

`createCityNetwork(city)` mantiene catálogo y cachés por ciudad. Un fallo
conserva el catálogo anterior cuando existe, señala la indisponibilidad y
permite consultar el resto. Apagar un provider invalida snapshots y evita sus
salidas. Variable de arranque: `TRANSIT_DISABLED_PROVIDERS=id,id` (IDs locales).

`server/transit` contiene calendarios, planes, métricas, snapping, observaciones,
anclado GPS y aplicación de TU/VP. `applyRealtime.ts` contiene el procesamiento
compartido antes ubicado en `RealtimeProvider`; el adaptador descarga y delega.
No se han sustituido los cálculos existentes. El matching municipal y las
peculiaridades de Bizkaibus siguen en sus adapters.

En el cliente, `gpsMotion.ts`, `progressFollower.ts`, `motion.ts` y
`vehiclePose.ts` mantienen movimiento/pose comunes. `vehicleLod.ts` lee el
aspecto normalizado conservando umbrales 11/14/16, escalas, capacidad visible
y exclusión iconos/modelos. `vehicleModels.ts` no cambia.

Calendarios y timelines reciben la zona del manifest. Las llamadas antiguas
conservan Madrid por compatibilidad. Nocturnos, excepciones y DST mantienen tests.

## Tiempos y calidad

Todos los timestamps públicos son Unix en milisegundos:

| Campo | Significado |
|---|---|
| `sourceTimestamp` | GPS/emisión de la predicción del vehículo; null para horario |
| `receivedTimestamp` | Recepción del dato/cache en backend; null si desconocida |
| `fetchedAt` / `checkedTimestamp` | Creación del snapshot / evaluación del provider |
| `predictionTimestamp` / tiempo de render | Cálculo de posición, independiente del dato/recepción |

Una respuesta HTTP repetida conserva recepción e instante GPS. El realtime
caducado conserva su timestamp para diagnosticar `stale`, aunque sus entidades
ya no alimenten posiciones. El ZIP estático usa la fecha local del archivo como
recepción, no generación. El horario del adapter legado Bizkaibus puede tener
recepción desconocida; no hereda la recepción GPS para fingir conocerla.

`positionSource` distingue `GPS`, `PROVIDER_ESTIMATED`,
`INTERPOLATED_REALTIME`, `SCHEDULE_SIMULATION` y `STALE`.
El snapshot describe la posición normalizada; el renderer calcula la fuente
dibujada sin mutar el dato. Horario se etiqueta estimado, no vehículo físico
observado. Frescura común: 45 s GPS reciente; 180 s máximo realtime.

## API

- `GET /api/cities`, `/api/cities/default`, `/api/cities/:cityId`.
- `GET /api/providers/health?cityId=es-bilbao`.
- `GET /api/network`: manifest, operadores, líneas, paradas y lugares.
- `GET /api/transit`: vehículos y salud/capacidades por provider.
- `POST /api/geometries`: hasta 100 IDs normalizados de shapes.
- `GET /api/lines/:operatorId/:externalRouteId?direction=all`.
- `GET /api/stops/:operatorId/:externalStopId`.
- `GET /api/trips/:operatorId/:externalTripId?date=YYYYMMDD&vehicleId=ID_GLOBAL`.

Consultas de red admiten `cityId`; omitirlo conserva Bilbao. Codificar IDs
externos con `encodeURIComponent`. Los endpoints antiguos de Bizkaibus
permanecen por compatibilidad.

El frontend pide manifest antes de crear mapa, filtros y shell. Usa su zona,
aspecto, capas y capacidades. Migra favoritos identificados en el catálogo
y conserva referencias desconocidas.

Pruebas, archivos y deuda: [modular-core.md](modular-core.md).
