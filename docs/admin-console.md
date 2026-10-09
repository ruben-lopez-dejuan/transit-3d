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

## Protección opcional

Si el servidor está expuesto a Internet, configura un token solo en el backend:

```powershell
$env:TRANSIT_ADMIN_TOKEN="una-cadena-larga-y-aleatoria"
npm start
```

El navegador lo pide al abrir la consola, lo conserva únicamente en
`sessionStorage` y lo envía en `X-Admin-Token`. No se incluye en URLs, paquetes de
ciudad, logs ni respuestas. Si la variable no está configurada, la vista de solo
lectura queda abierta, que es el comportamiento cómodo para desarrollo local.

## Semántica

- **GPS real**: coordenadas físicas publicadas por la fuente.
- **Estimación del proveedor**: el operador publica una posición calculada.
- **Interpolado realtime**: Transit 3D avanza entre observaciones reales.
- **Simulación horaria**: posición obtenida únicamente del GTFS estático.
- **Dato caducado**: la última observación superó el límite de frescura.

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
