# Inspector de posiciones

La ruta /debug abre la aplicacion normal con un inspector de vehiculos. En desarrollo local no necesita credenciales. En un despliegue remoto utiliza el mismo TRANSIT_ADMIN_TOKEN que /admin; el token se guarda solo en sessionStorage y se envia mediante X-Admin-Token.

## Que compara

Al seleccionar un vehiculo aparecen cuatro referencias sobre el mismo mapa:

- **Proveedor (rojo):** coordenada del registro decodificado por el adaptador.
- **Proyectada (azul):** progreso observado proyectado sobre el shape.
- **Objetivo (ambar):** posicion que el predictor considera objetivo en ese instante.
- **Pantalla (verde):** coordenada que TransitRenderer esta dibujando.

El panel mantiene separados sourceTimestamp, receivedTimestamp y el tiempo del motor. Tambien muestra latencia de ingestion, antiguedad, progreso, error de correccion, velocidades, cadencia, calidad y LOD.

Los bloques JSON contienen el registro que entra al contrato AdapterVehicle, el vehiculo normalizado, la presentacion enviada al frontend y los diagnosticos del motor. El boton **Copiar informe** genera un unico JSON util para incidencias.

## Coste y retencion

La captura detallada se activa por ciudad cuando se consulta el endpoint protegido de debug. Fuera de ese modo el pipeline solo hace una comprobacion constante y no clona vehiculos. Se conservan como maximo 20 observaciones por vehiculo durante 30 minutos, con un limite global de 2.000 vehiculos. Las respuestas HTTP repetidas con la misma observacion no crean puntos nuevos.

Las simulaciones puras de horario se pueden inspeccionar en frontend, pero no ocupan el historial de observaciones fisicas.

## Uso

    http://localhost:3001/debug?city=es-bilbao
    http://localhost:3001/debug?city=es-madrid

La busqueda acepta linea, operador, destino, ID fisico o ID interno. Tambien se puede seleccionar directamente un vehiculo en el mapa. La URL conserva vehicle=..., de modo que un caso concreto se puede compartir dentro del mismo entorno.
