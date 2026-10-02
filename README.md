# Bilbao Transit 3D

Mapa de transporte público con vehículos, líneas, destinos y próximas llegadas.
Integra 34 proveedores: Bizkaibus, Bilbobus, Metro Bilbao, Euskotren (tren y
tranvías), Renfe Cercanías y los feeds adicionales verificados de Moveuskadi,
incluido el funicular de Artxanda.

## Calidad de los datos

- **REAL / INTERPOLADO:** GPS válido de Bizkaibus, Bilbobus y Renfe; también Dbus
  y Tuvisa cuando sus feeds están frescos. La interpolación respeta los timestamps
  del operador y se detiene en la última posición observada.
- **ESTIMADO con predicciones:** Metro Bilbao y Euskotren/tranvías tienen
  TripUpdates útiles, pero no posiciones GPS publicadas en la auditoría.
- **ESTIMADO por horario:** Artxanda y los demás operadores sin realtime
  utilizable; también es el fallback cuando caducan los datos de un operador.

La hora del dato, la consulta al servidor y la posición animada se mantienen
separadas. Una consulta HTTP no rejuvenece una señal antigua.
Fuentes, protocolos, fallos y limitaciones: [docs/data-sources.md](docs/data-sources.md).

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
- Modelos 3D al acercarse: buses con ruedas/ventanas/luces, Bilbobus rojo y
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

`server/providers/catalog.ts` y `moveuskadi-sources.json` registran los proveedores.
Los refrescos realtime son independientes. GTFS y catálogo se renuevan cada seis
horas, con caché de ZIP validado y estructuras preparadas en disco. Se reutilizan
planes y geometrías por feed. Three.js se carga al acercarse; los modelos utilizan
instancias y se filtran por área visible.

## Comprobaciones

```powershell
npm test                     # core + frontend, sin red externa
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

## Instalación web existente

Se conserva el manifest y service worker existentes. Para instalar en un móvil
se requiere HTTPS. El worker almacena shell y assets; no almacena `/api/*`, feeds
ni teselas. Sin conexión se muestra la edad del último snapshot y se retiran
posiciones después de tres minutos. Capacitor y el planificador A → B quedan
fuera de este trabajo.
