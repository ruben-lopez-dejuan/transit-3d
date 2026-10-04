# Interfaz web usable

## Consultas principales

La aplicación abre en el mapa de Bilbao. Los filtros principales seleccionan Todos, Bus, Metro/tren o Tranvía. Capas permite desactivar operadores y consultar el tipo de fuente. El buscador encuentra líneas por número y paradas/estaciones por nombre, sin depender de mayúsculas ni tildes; también ofrece algunos lugares de la red. No es un geocodificador general ni un planificador de rutas.

Al seleccionar un vehículo se ve destino, calidad de posición, próxima parada, desfase estimado cuando existe, recorrido y seguimiento de cámara. Mover el mapa manualmente detiene el seguimiento. Una línea muestra sentidos, vehículos activos, próximas salidas desde cabecera y paradas de un recorrido de referencia. Una parada muestra próximos servicios, combinando las paradas a menos de 80 m.

Desktop usa panel lateral; móvil usa panel inferior con asa para reducir/expandir. Las líneas y paradas pueden guardarse como favoritos en el dispositivo. La búsqueda permite flechas y Enter, `/` para enfocar y Escape para cerrar. La ubicación solo se solicita cuando la persona pulsa Mi ubicación.

## Datos y fallos

- GPS reciente: círculo lleno; observación menor de 45 s.
- Estimada: contorno ámbar; movimiento derivado de GPS anterior.
- Horario: círculo hueco; posición calculada con GTFS estático.

Los detalles y la leyenda añaden etiquetas de texto, además del color. Los horarios se muestran en Europe/Madrid. Un horario o un desfase inferido no es una garantía de llegada real. La falta de datos no se oculta: Capas informa del estado de cada fuente y la barra inferior informa de conexión/frescura. Sin snapshot nuevo durante tres minutos se retiran vehículos del mapa.

El mapa se actualiza independientemente de los feeds. Los recorridos se descargan por lotes, conservan distancias acumuladas y se almacenan en memoria. Los vehículos muestran rumbo al acercarse; en zoom 17 aparecen cuerpos 3D simples. Los edificios se extruyen cuando la cartografía proporciona la capa building. Los modos claro, oscuro y sistema se guardan localmente. Cada ciudad conserva también cámara, modo, operadores, capas y visualización de túneles.

## Instalación y revisión

La PWA necesita HTTPS al abrirla desde un teléfono. El build genera manifest, iconos y service worker. El shell y los assets se guardan; los endpoints realtime y la cartografía quedan fuera de esa caché. Los manifiestos y catálogos estables utilizan caché HTTP revalidable. Capacitor no está configurado.

Comprobaciones realizadas el 2 de octubre de 2026:

- Build TypeScript/Vite pasando.
- Tests unitarios de parser, calendario, DST, medianoche, aislamiento entre providers, movimiento, búsqueda y escape de etiquetas pasando.
- Smoke de APIs para los cuatro operadores pasando: 169 líneas y 3.137 paradas; los vehículos activos varían según la hora.
- Revisión en navegador de búsqueda por parada/código, selección de línea, sentido, próximos servicios, detalle de vehículo y apariencia.
- Revisión responsive a tamaño móvil y desktop.

Para desarrollo: `npm run dev`, abrir http://localhost:5173. Para la web compilada: `npm run build` y `npm start`, abrir http://localhost:3001. Para los diagnósticos del vehículo seleccionado: añadir `?debug=1`.

## Pendiente

TripUpdates, avisos de servicio, más lugares/geocodificación, selección detallada de ramales y recarga de GTFS sin reinicio. La cámara y el movimiento están conectados a datos normalizados; se puede mejorar el predictor inicial de Bizkaibus con historia de progreso y retrasos explícitos. La siguiente fase puede completar estos puntos sin rehacer la interfaz.
