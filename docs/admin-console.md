# Consola de administración

La consola de diagnóstico está disponible en `/admin`. Es una vista de solo
lectura para responder rápidamente a cuatro preguntas:

1. qué proveedores están registrados en cada ciudad;
2. qué catálogos GTFS han cargado y cuántas rutas, viajes, paradas y shapes tienen;
3. cuántos vehículos proceden de GPS, predicción realtime, interpolación,
   horario o una señal caducada;
4. qué proveedor está degradado y cuál es la causa observable.

La lista inicial de ciudades es barata: lee el registro y el último estado en
memoria, pero no descarga sus feeds. Solo al seleccionar una ciudad se prepara
su catálogo y su instantánea. Esto evita volver a disparar la carga de Madrid,
Málaga y el resto de redes a la vez.

## Ejecutar

```powershell
npm run dev
```

Abrir `http://localhost:5173/admin`. En una compilación servida por Express:

```powershell
npm run build
npm start
```

Abrir `http://localhost:3001/admin`.

La consola se actualiza cada 30 segundos mientras la pestaña está visible. El
botón **Actualizar** fuerza una nueva lectura respetando las cachés normales del
backend. **Copiar JSON** permite adjuntar el diagnóstico en un informe.

La vista inicial mantiene todos los proveedores plegados y muestra en cada fila
el total de vehículos junto al reparto entre GPS, estimación/interpolación,
simulación horaria y datos caducados. Al abrir una fila aparecen el catálogo,
los timestamps, capacidades, incidencias y la muestra de vehículos.

En Windows, los endpoints oficiales de Euskadi pueden depender de certificados
instalados en el sistema. Los comandos `npm run dev`, `npm start` y las auditorías
de fuentes arrancan Node con ese almacén de certificados. Si un servidor anterior
se inició antes de esta configuración, hay que detenerlo y volver a ejecutar el
comando para que los feeds de Moveuskadi puedan refrescarse.

El proceso de desarrollo supervisa la API y la reinicia después de un cambio o
una caída. Si el puerto 3001 estaba ocupado durante el arranque, sigue
reintentando hasta recuperarlo en vez de dejar Vite funcionando sin backend.

## Protección opcional

Si el servidor está expuesto a Internet, configura un token solo en el backend:

```powershell
$env:TRANSIT_ADMIN_TOKEN="una-cadena-larga-y-aleatoria"
npm start
```

El navegador lo pide al abrir la consola, lo conserva únicamente en
`sessionStorage` y lo envía en `X-Admin-Token`. No se incluye en URLs, paquetes de
ciudad, logs ni respuestas. Si la variable no está configurada, la vista de solo
lectura queda abierta. En desarrollo, las peticiones desde `localhost` tampoco
requieren token; el acceso por LAN y cualquier ejecución con `NODE_ENV=production`
sí respetan el token configurado.

## Semántica

Cada operador separa dos preguntas.

**Posición · de dónde sale**

- **GPS observado**: coordenadas físicas publicadas por la fuente.
- **Interpolado entre lecturas GPS**: Transit 3D avanza entre observaciones reales.
- **Estimado con predicciones**: posición calculada con previsiones de llegada
  (SIRI, GTFS-RT o API del operador), sin GPS.
- **Simulado con horario GTFS**: posición obtenida únicamente del GTFS estático.
- **Caducado**: la última observación superó el límite de frescura (270 s).

**Llegadas · qué las calcula** (`timelineSource`)

- **SIRI · previsiones por parada**: horas esperadas publicadas por SIRI.
- **GTFS-RT · TripUpdates con predicción**: TripUpdates que predicen algo
  distinto del horario. Los que solo repiten el horario se descartan y no cuentan.
- **API del operador · ETA propias**: previsiones de una API no estándar.
- **Horario GTFS desplazado con GPS**: horario estático adelantado o retrasado
  según la última posición GPS.
- **Horario GTFS sin ajustes**: solo GTFS estático.

**Fiabilidad pública** (`shared/transit/reliability.ts`)

La vista pública no usa estos términos. Muestra un único nivel de confianza,
igual para posiciones y horas de llegada, sea cual sea el método:

- **Tiempo real**: GPS fresco, o llegadas en tiempo real frescas sin GPS
  (Metro Bilbao). Un viaje deducido (Bilbobus) no rebaja la posición GPS.
- **Aproximado**: estimación de posición del operador (paneles de Metro Madrid);
  en llegadas, horario desplazado según el GPS.
- **Horario**: horario GTFS, o datos en tiempo real de más de 270 s.

Internamente se clasifican el tipo de alimentación del proveedor (posiciones,
solo predicciones de llegada, solo horario) y la base de cada posición (GPS,
llegadas en tiempo real, estimación del operador, horario). La consola muestra
ambos junto al nivel público.

La consola muestra por separado la hora del dato de la fuente, la hora de
recepción en el backend y la última comprobación. No usa la hora de la petición
HTTP para rejuvenecer una observación antigua.

Los avisos son indicios para depurar, no afirmaciones absolutas. Por ejemplo,
“GPS ausente” puede ser normal de madrugada si en ese momento no hay servicio.
El detalle incluye una muestra limitada de vehículos y no muestra endpoints,
cabeceras ni credenciales de proveedores. Los mensajes de error se truncan y
redactan antes de salir del backend.

## Endpoints

- `GET /api/admin/cities`: índice ligero sin inicializar todas las ciudades.
- `GET /api/admin/cities/:cityId`: catálogo, instantánea, health y hallazgos de
  una sola ciudad.

Con token configurado, ambos requieren `X-Admin-Token`. Son endpoints de lectura
y tienen `Cache-Control: no-store`.
