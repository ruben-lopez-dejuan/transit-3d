# Transit 3D

Mapa de transporte público con vehículos, líneas, destinos y próximas llegadas.
Incluye selector de ciudad y paquetes para Bilbao/Euskadi, Málaga y Madrid.
Bilbao integra 34 proveedores: Bizkaibus, Bilbobus, Metro Bilbao, Euskotren (tren y
tranvías), Renfe Cercanías y los feeds adicionales verificados de Moveuskadi,
incluido el funicular de Artxanda.

Madrid añade Metro estimado desde teleindicadores oficiales, Cercanías con GPS
cuando Renfe lo publica, llegadas EMT opcionales con autenticación y horarios
CRTM. Estado y configuración: [city-packages/es-madrid/README.md](city-packages/es-madrid/README.md).

## Calidad de los datos

- **REAL / INTERPOLADO:** GPS válido de Bizkaibus, Bilbobus y Renfe; también Dbus
  y Tuvisa cuando sus feeds están frescos. La predicción usa tiempos y progreso
  originales, ajusta suavemente las nuevas observaciones y se etiqueta ESTIMADO
  cuando avanza más allá del último GPS. No recupera errores con acelerones.
- **ESTIMADO con predicciones:** Metro Bilbao y Euskotren/tranvías tienen
  TripUpdates útiles, pero no posiciones GPS publicadas en la auditoría.
- **ESTIMADO por horario:** Artxanda y los demás operadores sin realtime
  utilizable; también es el fallback cuando caducan los datos de un operador.

La hora del dato, la consulta al servidor y la posición animada se mantienen
separadas. Una consulta HTTP no rejuvenece una señal antigua.
Fuentes, protocolos, fallos y limitaciones: [docs/data-sources.md](docs/data-sources.md).

Para diagnosticar las fuentes de Euskadi sin abrir el mapa:
`npm run audit:euskadi-realtime`. Descarga una muestra por fuente conectada,
comprueba su edad y unión con los horarios, y guarda el informe en
`server/cache/audit/euskadi/report.json`. Una cabecera reciente no garantiza
que las observaciones individuales sigan vigentes.

Para Madrid: `npm run audit:madrid` inspecciona una muestra sin arrancar la app;
`npm run audit:madrid -- --cached` reproduce la copia en su instante original,
sin afirmar que sea el estado actual. Pruebas concretas: `npm run test:madrid`.

## Ejecutar localmente

```powershell
npm install
npm run dev
```

Abrir http://localhost:5173. La API está en el puerto 3001 y Vite la redirige.
Para servir la aplicación compilada:

```powershell
npm run build
npm start
```

Abrir http://localhost:3001. Express sirve la API y el frontend de `dist/`.
Se requiere salida HTTPS a las fuentes documentadas y espacio escribible para
`server/cache`. No se necesitan claves privadas del frontend.

## Interfaz

- Mapa claro/oscuro, búsqueda de líneas/paradas, favoritos y próximas llegadas.
- Capas independientes por operador y modo: tren, tranvía, bus y funicular.
- Vehículos reconocibles desde lejos; línea y destino con gestión de colisiones.
- Modelos 3D desde zoom 11: siluetas por modo, detalles desde 14 y 16,
  buses con ruedas/ventanas/luces, Bilbobus rojo y
  composiciones ferroviarias cuyos coches siguen individualmente las curvas.
- Selección y seguimiento conservan el detalle de los demás vehículos.
- Metro subterráneo transparente, con profundidad aproximada documentada.
- Panel lateral en escritorio y panel inferior en móvil.
- `?debug=1` muestra timestamps, progreso, velocidad y coste de preparación visual.

La separación lateral de trenes y sus composiciones son representaciones
 diagramáticas, sin inventario exacto de vías, cotas o material móvil.

## Arquitectura

Los adaptadores descargan y normalizan GTFS, GTFS-RT o JSON/SIRI. El motor común
resuelve calendario, viajes activos, geometría, snapping, predicciones y posiciones
por distancia sobre el shape. El navegador consume `/api/*` y comparte
interpolación, pose y renderizado para todos los operadores.

`shared/transit` contiene los contratos normalizados. El paquete
`server/cities/es-bilbao` declara manifest API 1, fuentes, proveedores y aspecto;
`server/cities/index.ts` registra Bilbao. El frontend recibe esa configuración.
Registry y cachés por ciudad aíslan identidades, desactivación y fallos.
Detalle: [docs/architecture.md](docs/architecture.md) y
[docs/modular-core.md](docs/modular-core.md).
Los refrescos realtime son independientes. GTFS y catálogo se renuevan cada seis
horas, con caché de ZIP validado y estructuras preparadas en disco. Se reutilizan
planes y geometrías por feed. Three.js se carga al acercarse; los modelos utilizan
instancias y se filtran por área visible.

## Comprobaciones

```powershell
npm test                     # core + frontend, sin red externa
npm run typecheck            # comprobación de tipos
npm run build                # tipos + compilación
npm run test:network         # API real, requiere servidor activo
npm run test:bizkaibus-gtfs   # descarga y análisis del feed
npm run test:bizkaibus-realtime
npx tsx server/profile-network.ts
npx tsx server/validate-live.ts
```

`TRANSIT_TEST_URL` cambia la URL del smoke test. Los scripts de perfil y observación
guardan diagnósticos en la caché ignorada por Git. Resultados y límites:
[docs/validation.md](docs/validation.md). MapLibre y Three.js todavía producen
avisos de tamaño de bundle; queda pendiente medir rendimiento sostenido en Android
físico.

El paquete de pulido visual se valida con código, unit tests y build;
las comprobaciones visuales quedan a cargo del usuario. Causas, LOD, cambios y
lista manual: [docs/visual-motion.md](docs/visual-motion.md).

El núcleo modular pasa 81 tests y conserva las comprobaciones de movimiento/LOD.
Después de actualizar, reinicia el servidor para cargar los endpoints de ciudad
y recarga la web con Ctrl+F5. Lista manual de esta fase:
[docs/modular-core.md](docs/modular-core.md#pruebas-manuales-para-el-usuario).

## Instalación web existente

Se conserva el manifest y service worker existentes. Para instalar en un móvil
se requiere HTTPS. El worker almacena shell y assets; no almacena `/api/*`, feeds
ni teselas. Sin conexión se muestra la edad del último snapshot y se retiran
posiciones después de tres minutos. Capacitor y el planificador A → B quedan
fuera de este trabajo.
