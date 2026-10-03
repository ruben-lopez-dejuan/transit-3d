import { NapClient } from './nap';
const value = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const region = value('region'), query = (value('query') ?? '').toLocaleLowerCase('es'), operator = (value('operator') ?? '').toLocaleLowerCase('es'), mode = (value('mode') ?? '').toLocaleLowerCase('es'), format = (value('format') ?? '').toLocaleLowerCase('es');
if (!region && !query && !operator && !mode && !format) throw new Error('Usa --region, --query, --operator, --mode o --format.');
const client = new NapClient();
let regionId: number | undefined;
if (region) {
  const candidates = await client.findRegions(region);
  const exact = candidates.filter((r) => r.nombre.localeCompare(region, 'es', { sensitivity: 'base' }) === 0);
  const selected = exact.find((r) => r.tipoNombre === 'Provincia') ?? exact.find((r) => r.tipoNombre === 'AreaUrbana') ?? exact[0] ?? candidates[0];
  if (!selected) throw new Error(`NAP no encontró la región ${region}.`);
  if (selected.tipoNombre !== 'Provincia') throw new Error(`NAP busca conjuntos por provincia; especifica el nombre de la provincia (resultado actual: ${selected.tipoNombre}).`);
  regionId = selected.id;
}
const rows = (await client.getDatasets(regionId)).filter((dataset) => {
  const text = `${dataset.nombre} ${dataset.descripcion}`.toLocaleLowerCase('es');
  return (!query || text.includes(query)) && (!operator || dataset.operadores.some((o) => o.nombre.toLocaleLowerCase('es').includes(operator))) && (!mode || dataset.tiposTransporte.some((m) => m.nombre.toLocaleLowerCase('es').includes(mode))) && (!format || dataset.ficheros.some((f) => f.nombreTipoFichero.toLocaleLowerCase('es').includes(format)));
}).map((dataset) => ({ datasetId: dataset.id, name: dataset.nombre, publisher: dataset.organizacion?.nombre ?? '', operators: dataset.operadores.map((o) => o.nombre), coverage: dataset.regiones.map((r) => `${r.nombre} (${r.nombreTipo})`), modes: dataset.tiposTransporte.map((m) => m.nombre), obsolete: dataset.isObsolete, files: dataset.ficheros.map((f) => ({ fileId: f.id, format: f.nombreTipoFichero, valid: f.esValido, updatedAt: f.fechaActualizacion, validFrom: f.fechaDesde, validTo: f.fechaHasta, routes: f.numeroRutas, trips: f.numeroViajes, stops: f.numeroParadas, bytes: f.tamanio })) }));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else for (const row of rows) { console.log(`\n${row.datasetId} · ${row.name} · ${row.publisher}`); console.log(`  ${row.modes.join(', ')} · ${row.operators.join(', ')}`); for (const file of row.files) console.log(`  fichero ${file.fileId} · ${file.format} · ${file.valid ? 'válido' : 'no validado'} · actualizado ${file.updatedAt ?? 'desconocido'} · vigencia ${file.validFrom ?? '?'} → ${file.validTo ?? '?'}`); }
if (!rows.length) console.log('Sin candidatos con esos filtros.');
