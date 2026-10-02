# Ciudades adicionales

Copia aquí una carpeta `<cityId>/` que contenga directamente `city.json`.
Ejemplo de destino futuro: `city-packages/es-malaga/city.json`.
No pegues el ZIP ni una carpeta contenedora adicional.

Ejecuta `npm run cities:check` y reinicia el servidor. Las ciudades válidas se
añaden automáticamente al selector; una carpeta inválida no impide arrancar Bilbao.
Los errores aparecen en consola y en `/api/city-packages`.

Contrato y prompt para generar paquetes desde un chat normal:
`docs/city-package-kit/FORMAT.md` y `docs/city-package-kit/PROMPT.md`.
Bilbao sigue integrado en `server/cities/es-bilbao`; no lo dupliques aquí.
