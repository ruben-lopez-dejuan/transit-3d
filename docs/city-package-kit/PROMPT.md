# Prompt para pegar en un chat normal de ChatGPT

Adjunta `FORMAT.md` y, preferiblemente, `city.schema.json` de esta misma carpeta.
Cambia Málaga por la ciudad/núcleo que quieras integrar.

---

Prepara un paquete de ciudad para **Málaga y su núcleo urbano** que pueda integrar
en mi aplicación Transit 3D copiando una carpeta. Estoy en un chat normal; no
quiero usar Work ni que modifiques mi repositorio.

El documento FORMAT.md adjunto y city.schema.json, si está adjunto, son el contrato
autoritativo API 1. Respeta exactamente sus campos, protocolos y limitaciones.
No inventes un plugin TypeScript, otro formato de instalación ni dependencias.

Investiga fuentes públicas oficiales actuales de los operadores relevantes.
Descarga realmente cada GTFS/GTFS-RT que vayas a utilizar y analiza su contenido.
Comprueba vigencia de servicios, shapes, ambos sentidos, paradas, zona horaria y
IDs. Para feeds nacionales selecciona los route_id exactos de este núcleo y
decláralos en routeIds. No incluyas líneas de otras ciudades por accidente.

Distingue GPS real, GPS espaciado con interpolación, predicciones de llegada y
horario estático. Solo incluye URLs realtime verificadas y compatibles con el
GTFS. Si una fuente requiere pago/credenciales o usa un protocolo no soportado,
documéntala como excluida y utiliza la mejor alternativa pública verificada.
No simules que has descargado un feed. Si tus herramientas no permiten descargar
y analizar, pídeme los archivos necesarios antes de declarar el paquete listo.

Entrega un ZIP descargable con esta estructura, sin carpeta exterior adicional:

```text
es-malaga/
  city.json
  README.md
  data-sources.md
```

city.json debe ser JSON estricto compatible con el contrato, sin placeholders,
credenciales ni código. README debe explicar operadores incluidos, alcance,
instalación, reinicio y comprobaciones. data-sources.md debe contener evidencias
reales de descarga/análisis, fecha, hashes, conteos, IDs, timestamps, licencias,
fallbacks, limitaciones y fuentes descartadas, según FORMAT.md.

Revisa el JSON contra el esquema y las reglas adicionales de FORMAT.md antes de
entregarlo. No afirmes haber probado mi aplicación, su build o su renderizado.
Si solo puedes integrar parte de la ciudad, declara claramente el alcance.

Si no puedes crear un ZIP en este chat, entrega el contenido íntegro de los tres
archivos, con sus nombres y estructura, para que yo pueda guardarlos. No inventes
un enlace de descarga. No entregues solo un plan ni una lista de endpoints.
