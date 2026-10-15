# Interfaz web usable

## Consultas principales

La aplicación abre en el mapa de Bilbao. Los filtros principales seleccionan Todos, Bus, Metro/tren o Tranvía. Capas permite desactivar operadores y consultar el tipo de fuente. El buscador encuentra líneas por número y paradas/estaciones por nombre, sin depender de mayúsculas ni tildes; también ofrece algunos lugares de la red. No es un geocodificador general ni un planificador de rutas.

Al seleccionar un vehículo se ve destino, calidad de posición, próxima parada, desfase estimado cuando existe, recorrido y seguimiento de cámara. Sus acciones (Seguir, Ver línea, Recorrido) están ya en la tarjeta compacta del móvil; tocar la próxima parada abre su ficha, y la estrella guarda la línea del vehículo en favoritos. Desde la línea o la parada abiertas así, «Volver al vehículo» regresa a él. Arrastrar el mapa con un dedo (o el ratón) detiene el seguimiento y lo avisa; pellizcar o girar con dos dedos lo mantiene.

Modo zen (Z, botón del loto o Capas): oculta etiquetas e interfaz. Con un vehículo seleccionado, su tarjeta se oculta y la cámara pasa a seguirlo; al salir vuelve la tarjeta y el seguimiento sigue activo. En el móvil los botones del mapa se colocan encima de la tarjeta (sin los de zoom, que se sustituyen por el pellizco) y se apartan si la tarjeta desplegada no les deja sitio. Una línea muestra sentidos, vehículos activos, próximas salidas desde cabecera y paradas de un recorrido de referencia. Una parada muestra próximos servicios, combinando las paradas a menos de 80 m.

Desktop usa panel lateral; móvil usa panel inferior con asa para reducir/expandir: la tarjeta compacta se abre tocándola o deslizándola hacia arriba y se cierra deslizándola hacia abajo. Las líneas y paradas pueden guardarse como favoritos en el dispositivo. La búsqueda permite flechas y Enter, `/` para enfocar y Escape para cerrar. La ubicación solo se solicita cuando la persona pulsa Mi ubicación.

## Datos y fallos

- GPS reciente: círculo lleno; observación menor de 45 s.
- Estimada: contorno ámbar; movimiento derivado de GPS anterior.
- Horario: círculo hueco; posición calculada con GTFS estático.

Los detalles y la leyenda añaden etiquetas de texto, además del color. Los horarios se muestran en Europe/Madrid. Un horario o un desfase inferido no es una garantía de llegada real. La falta de datos no se oculta: Capas informa del estado de cada fuente y la barra inferior informa de conexión/frescura. Sin snapshot nuevo durante tres minutos se retiran vehículos del mapa.

El mapa se actualiza independientemente de los feeds. Los recorridos se descargan por lotes, conservan distancias acumuladas y se almacenan en memoria. Los vehículos muestran rumbo al acercarse; en zoom 17 aparecen cuerpos 3D simples. Los edificios se extruyen cuando la cartografía proporciona la capa building. Los modos claro, oscuro y sistema se guardan localmente. Cada ciudad conserva también cámara, modo, operadores, capas y visualización de túneles.

## Instalación y revisión

La PWA necesita HTTPS al abrirla desde un teléfono. El build genera manifest, iconos y service worker. El shell y los assets se guardan; los endpoints realtime y la cartografía quedan fuera de esa caché. Los manifiestos y catálogos estables utilizan caché HTTP revalidable. Capacitor no está configurado. El icono de la app es `public/icon.svg`; `server/generate-brand-icons.ps1` repite su geometría para regenerar `icon-192.png` e `icon-512.png` (si se cambia uno, hay que cambiar el otro).

Comprobaciones realizadas el 2 de octubre de 2026:

- Build TypeScript/Vite pasando.
- Tests unitarios de parser, calendario, DST, medianoche, aislamiento entre providers, movimiento, búsqueda y escape de etiquetas pasando.
- Smoke de APIs para los cuatro operadores pasando: 169 líneas y 3.137 paradas; los vehículos activos varían según la hora.
- Revisión en navegador de búsqueda por parada/código, selección de línea, sentido, próximos servicios, detalle de vehículo y apariencia.
- Revisión responsive a tamaño móvil y desktop.

Para desarrollo: `npm run dev`, abrir http://localhost:5173. Para la web compilada: `npm run build` y `npm start`, abrir http://localhost:3001. Para los diagnósticos del vehículo seleccionado: añadir `?debug=1`.

## Pendiente

TripUpdates, avisos de servicio, más lugares/geocodificación, selección detallada de ramales y recarga de GTFS sin reinicio. La cámara y el movimiento están conectados a datos normalizados; se puede mejorar el predictor inicial de Bizkaibus con historia de progreso y retrasos explícitos. La siguiente fase puede completar estos puntos sin rehacer la interfaz.

Los vehículos se pintan con la librea real de su flota (`livery` en `VehicleAppearance`, definida por operador en `server/cities/es-bilbao/providers.ts`), no con el color de la línea, que queda para trazados y distintivos. Sin librea confirmada se usa el color de la línea. El icono 2D dibuja el número real de coches de la composición. Los iconos de modo de la interfaz están en `src/icons.ts`.
