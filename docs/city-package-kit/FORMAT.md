# Contrato para generar una ciudad de Transit 3D desde ChatGPT

Versión del contrato: **1**. Este documento es autocontenido y se puede adjuntar
a un chat normal de ChatGPT. No hace falta acceso al repo para producir el paquete.
El esquema complementario es `city.schema.json`. `city.example.json` es una plantilla
con una URL reservada de ejemplo, **no una fuente ni una ciudad funcional**.

## Entrega e instalación

Entrega un ZIP que al extraerlo produzca directamente:

```text
es-<ciudad>/
  city.json
  README.md
  data-sources.md
```

El usuario copia esa carpeta a `city-packages/` en la raíz del repo, ejecuta
`npm run cities:check` y reinicia el servidor. La ciudad aparece automáticamente
en el selector. No hay que modificar código, registry, renderer ni package.json.
No incluir código ejecutable, node_modules, .git, credenciales ni dependencias.
Los feeds públicos se descargan en el servidor al utilizar la ciudad.
El contenido ZIP no lo instala la aplicación: el usuario extrae y copia la carpeta.

`cities:check` valida configuración, **no descarga ni certifica los feeds**.
Una fuente caída no impide cargar las demás. Un paquete inválido se omite y se
diagnostica en consola y en `/api/city-packages`. Una fuente inválida dentro de
un JSON válido figura como operador no disponible al consultar la red.

## city.json: campos admitidos

Sin campos adicionales. JSON estricto, sin comentarios ni bloques Markdown.

| Campo | Regla |
|---|---|
| apiVersion | `1` para URLs directas heredadas; `2` para descriptores de fuente explícitos |
| id | `es-malaga`, por ejemplo. Prefijo de país en minúsculas, slug sin espacios; mismo nombre que la carpeta |
| countryCode | Código de país ISO de dos letras mayúsculas; debe corresponder al prefijo de id |
| name, region | Nombre visible de ciudad/núcleo y región |
| timezone | Zona horaria válida de Intl, preferentemente IANA, p. ej. Europe/Madrid |
| center | `[longitud, latitud]`, WGS84; dentro de bounds |
| bounds | `[[lonOeste, latSur], [lonEste, latNorte]]`, límites estrictamente ordenados, sin cruce del antimeridiano |
| modes | Lista sin duplicados de bus, rail, tram, funicular, unknown; solo modos integrados |
| presentation | Objeto obligatorio descrito abajo |
| providers | Lista de 1 a 100 operadores; IDs únicos dentro de la ciudad |

Textos: entre 1 y 500 caracteres, con al menos un carácter no blanco.
Coordenadas finitas: longitud −180 a 180; latitud −90 a 90.

`presentation` contiene exactamente:

```json
{
  "title": "Transit 3D",
  "mapLabel": "Mapa de transporte de la ciudad",
  "searchLabel": "Buscar transporte en la ciudad",
  "initialZoom": 12.5,
  "brandMark": "t."
}
```

`initialZoom` va de 0 a 20. Los demás campos son textos.

Cada provider requiere `id`, `name`, `color`, `sources`:

- `id`: slug en minúsculas, dígitos y guiones, p. ej. `metro`.
- `name`: nombre del operador.
- `color`: `#RRGGBB`, basado en su identidad verificada.
- En API 1, `sources.gtfs`, `tripUpdates` y `vehiclePositions` conservan exactamente sus URLs HTTPS directas.
- En API 2, cada fuente es `{ "type": "http", "url": "https://..." }` o `{ "type": "nap", "datasetId": 896, "fileId": 1097 }`.
- Los IDs NAP son los identificadores estables del conjunto y fichero. El enlace firmado y temporal se resuelve en backend cada vez que se descarga.
- `NAP_API_KEY` solo se configura en el entorno del servidor. No se admite en `city.json`.
- Omitir las claves realtime cuando no haya fuente verificada; no poner null.
- URLs sin usuario/contraseña, fragmentos ni autenticación privada. No enlazar una
  página HTML de descarga como si fuese el ZIP. No incrustar tokens.

Campos opcionales por provider:

| Campo | Significado |
|---|---|
| primary | Boolean; operador principal mostrado directamente en Capas, fuera de grupos plegables. Todos los operadores se activan inicialmente |
| group | Texto para agrupación en Capas |
| routeIds | Lista no vacía y sin duplicados de route_id **exactos del GTFS**, máximo 10 000. No route_short_name. Necesaria para acotar feeds nacionales o de varias ciudades |
| maximumGpsSpeed | Límite de rechazo de observaciones imposibles en m/s, 1–120. Omitir si no se justifica con el modo/fuente |
| appearance | Metadatos comunes de composición 3D, objeto completo descrito abajo; opcional |

Ejemplo de `appearance` (metros):

```json
{
  "kind": "train",
  "composition": { "count": 3, "length": 23, "gap": 1 },
  "lateralOffsetMeters": 1.7
}
```

kind: bus/train/metro/tram/funicular/unknown. count: entero 1–16; length: 1–40;
gap: 0–10; lateralOffsetMeters: 0–10. Si se omite, se usa el modelo común según
el modo GTFS. En feeds con varios modos es preferible omitir una apariencia única
que convertir todos los vehículos en buses o trenes.
No declarar `capabilities` ni `realtime`: el runtime los deriva de las fuentes
que soporta. No incluir IDs de vehículos generados; la app crea namespaces seguros.

## Compatibilidad y calidad obligatorias

- Soporte directo: GTFS estático y GTFS-RT TripUpdates/VehiclePositions protobuf.
- GTFS debe contener rutas, trips, stops, stop_times, shapes con trazados útiles,
  y calendar y/o calendar_dates vigentes. frequencies es opcional y soportado.
  El ZIP debe tener las tablas directamente en su raíz.
- Analizar las rutas seleccionadas, viajes, servicios activos, ambas direcciones
  y correspondencia entre paradas y shapes. Shapes deben seguir el sentido del
  viaje. Geometría ausente, invertida o incoherente puede requerir mejorar un
  adaptador; este formato no inventa trazados ni los corrige automáticamente.
- Los IDs de TripUpdates/VehiclePositions deben corresponder al mismo GTFS.
- Fuentes realtime: verificar timestamps originales de cabecera/entidad,
  antigüedad y contenido útil. Un feed vacío de madrugada no demuestra ausencia
  de realtime; documentar la observación y no inventar vehículos.
- El core usa calendar/calendar_dates, zona horaria, horarios, stale y límites de
  movimiento comunes. GTFS solo se representa como SCHEDULE_SIMULATION; las
  llegadas TripUpdates generan posición estimada, no GPS. Un HTTP reciente no
  rejuvenece el timestamp del operador.
- Esta versión no instala adaptadores SIRI, NeTEx, JSON municipal o APIs privadas
  desde una carpeta. Tampoco consume ServiceAlerts, ocupación ni medidas de
  velocidad/bearing del proveedor como capacidades públicas de estos paquetes.
  El heading y movimiento se calculan con la geometría común.
- Túneles y lugares destacados de Bilbao siguen siendo hooks del paquete nativo.
  El formato de carpetas todavía no configura túneles ni puntos de interés.

## Verificar de verdad las fuentes antes de declarar «listo»

El chat debe investigar fuentes públicas oficiales actuales, **descargar** los
ZIP/protobuf y analizar su contenido. Una URL encontrada en una web no basta.
Registrar en `data-sources.md`, por cada operador:

1. organismo, página oficial, URL directa, licencia/atribución y fecha de consulta;
2. protocolo, descarga efectiva, tamaño, SHA-256 y tablas o entidades analizadas;
3. cantidad de rutas/trips/paradas/shapes y route_id seleccionados exactos;
4. vigencia calendar/calendar_dates y zona horaria del feed;
5. muestra de timestamps originales GTFS-RT y correspondencia de trip_id;
6. GPS real / GPS espaciado interpolado / predicción de llegada / horario;
7. geometría, cobertura de ciudad, limitaciones y fallback;
8. fuentes descartadas y motivo.

No inventar fechas, hashes, endpoints, licencias, verificaciones ni resultados.
Si el chat no puede descargar/analizar, debe pedir los feeds como archivos o
entregar un informe pendiente de verificación; no anunciar un paquete listo.
Operadores no compatibles deben quedar documentados fuera de `providers`.
Un paquete parcial puede ser útil si su alcance está explícito y al menos un
operador cumple el contrato y tiene una fuente realmente verificada.

Si el chat puede generar archivos, pedir un ZIP descargable. Si no puede,
pedir el contenido completo de los tres archivos y guardarlos manualmente.
La generación de texto/archivos no necesita modificar el repositorio desde Work.
