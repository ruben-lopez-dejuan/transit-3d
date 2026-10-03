import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { downloadFile } from '../lib/download';
import { NapApiError, NapClient } from './nap';
import { DefaultSourceResolver } from './resolver';

test('direct source resolves and downloads atomically without external internet', async () => {
  const server = http.createServer((_request, response) => { response.writeHead(200); response.end('feed'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-source-')), target = path.join(directory, 'feed.bin');
  try {
    const resolved = await new DefaultSourceResolver().resolve({ type: 'http', url: `http://127.0.0.1:${address.port}/feed` });
    assert.equal(resolved.temporary, false); assert.equal(await downloadFile(resolved, target), 4); assert.equal(fs.readFileSync(target, 'utf8'), 'feed');
    assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')).length, 0);
  } finally { server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('NAP stable dataset/file IDs resolve to a temporary download and keep ApiKey backend-only', async () => {
  const calls: { url: string; key: string | null }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers); calls.push({ url, key: headers.get('ApiKey') });
    const data = url.endsWith('/conjunto-dato/10') ? { id: 10, nombre: 'Feed', descripcion: '', fechaCreacion: '', ficheros: [{ id: 20, nombreTipoFichero: 'GTFS-ZIP', esValido: true, tamanio: 1, fechaActualizacion: '2026-10-03', fechaDesde: null, fechaHasta: null, numeroViajes: 1, numeroRutas: 1, numeroParadas: 1 }], operadores: [], regiones: [], tiposTransporte: [], isObsolete: false } : { enlaceDescarga: 'https://temporary.example/feed.zip?expires=1', nombreFichero: 'feed.zip', tipoContenido: null };
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const resolved = await new NapClient('secret-for-test', 'https://nap.test/api/v2', fetcher).resolve({ type: 'nap', datasetId: 10, fileId: 20 });
  assert.equal(resolved.identity, 'nap:10:20'); assert.equal(resolved.temporary, true); assert.equal(resolved.metadata?.format, 'GTFS-ZIP');
  assert.deepEqual(calls.map((call) => call.key), ['secret-for-test', 'secret-for-test']);
  assert.ok(calls.every((call) => call.url.startsWith('https://nap.test/'))); assert.ok(!JSON.stringify(resolved).includes('secret-for-test'));
});

test('NAP reports authentication, missing files, invalid JSON and timeout explicitly', async () => {
  const response = (status: number, body = '{}') => new Response(body, { status });
  await assert.rejects(() => new NapClient('bad', 'https://nap.test', async () => response(401)).getDataset(1), (e: unknown) => e instanceof NapApiError && /credencial/.test(e.message));
  await assert.rejects(() => new NapClient('key', 'https://nap.test', async () => response(200, 'bad')).getDataset(1), /JSON inválida/);
  const dataset = { id: 1, nombre: '', descripcion: '', fechaCreacion: '', ficheros: [], operadores: [], regiones: [], tiposTransporte: [], isObsolete: false };
  await assert.rejects(() => new NapClient('key', 'https://nap.test', async () => response(200, JSON.stringify({ success: true, data: dataset }))).resolve({ type: 'nap', datasetId: 1, fileId: 2 }), /no pertenece/);
  const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  await assert.rejects(() => new NapClient('key', 'https://nap.test', async () => { throw timeout; }).getDataset(1), /tiempo límite/);
});
