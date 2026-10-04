# Madrid en Transit 3D

Paquete API 1, datos declarativos en `city.json` y extensiones de servidor en `server/cities/es-madrid`. El frontend, los modelos 3D y el LOD siguen siendo comunes.

## Estado

- Metro: topología CRTM, L3 completa desde GIS oficial y posiciones estimadas por teleindicadores actuales; no se utiliza el calendario caducado.
- Cercanías: GTFS Renfe filtrado a Madrid, orientación por trip, GPS/TripUpdates oficiales y viajes ADDED verificados; horario cuando los feeds están vacíos o caducados.
- EMT: horario; llegadas por parada opcionales con `EMT_CLIENT_ID` y `EMT_PASSKEY` en el entorno del servidor. No se presenta la flota como GPS.
- Urbanos/interurbanos CRTM: horario.
- ML1: estimación por llegadas cuando hay evidencia suficiente; ML2/ML3/Parla: horario.

Cobertura, fuentes verificadas y límites: [data-sources.md](data-sources.md).

## Arranque y comprobación

Desde la raíz `C:\Users\ruben\transit-3d`:

```powershell
npm run cities:check
npm run dev
```

Selecciona «Madrid y Comunidad de Madrid» o usa `?city=es-madrid`. La API debe reiniciarse tras instalar este código. Para una compilación servida en el puerto 3001: `npm run build`, después `npm start`.

Opcional, antes de arrancar, con tus credenciales de MobilityLabs:

```powershell
$env:EMT_CLIENT_ID = '<tu client ID>'
$env:EMT_PASSKEY = '<tu passkey>'
npm run dev
```

Sin ellas no se intenta el login. `.env.example` enumera las variables; `npm run dev` y `npm start` cargan automáticamente el `.env` local cuando existe. No hace falta ninguna clave para Metro o Renfe.

Validación sin navegador: `npm run test:madrid`, `npm run typecheck`, `npm run build`. Auditoría de una muestra: `npm run audit:madrid`; reproducción offline: `npm run audit:madrid -- --cached`. El informe distingue reproducción de muestra y validación contra reloj actual.

## Pruebas manuales pendientes para el usuario

1. Cambia Bilbao ↔ Madrid ↔ Málaga y prueba zoom bajo/medio/alto. Deben conservarse clusters/iconos y los modelos 3D al acercar; nunca icono y modelo para el mismo vehículo. No se modificaron esos archivos.
2. En Madrid selecciona trenes de Metro de ambos sentidos, incluida L3 hasta El Casar. Deben seguir curvas y detenerse brevemente; mostrar ESTIMADO, sin «último GPS». Las horas no respaldadas deben quedar en blanco. Puede faltar R por evidencia insuficiente.
3. Cuando Renfe entregue GPS, selecciona un Cercanías: comprueba ID, timestamp original, sentido y transición suave en 2–3 lecturas diferentes. Si el feed viene vacío, debe indicar horario, no REAL.
4. Si configuras EMT, abre una parada y comprueba llegadas realtime. Los buses del mapa siguen indicando horario. Un error de autenticación no debe quitar otros operadores.
5. Desactiva un operador y comprueba que los demás siguen presentes. Con Bizkaibus en Bilbao, observa dos o tres actualizaciones de fuente: no debe recuperar retrasos con acelerones ni renovar la señal al recibir el mismo dato.
6. Si hay saltos, duplicados, trenes al revés o desaparición del 3D, devuelve URL con `?city=…&debug=1`, línea/vehículo, `source timestamp`, `received timestamp`, `position source`, progreso, velocidad, `LOD`, `3D fallback`, y logs `[transit-motion]` si es GPS. Para Madrid adjunta también `runtime-report.json` y el estado de `/api/providers/health?cityId=es-madrid`. No incluyas claves ni tokens.
