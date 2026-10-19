import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLibraryServer } from './servir';

let root: string;
let base: string;
let close: () => Promise<void>;

/** A raw GET (fetch would undo the compression we want to see). */
function get(urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    const req = request(`${base}${urlPath}`, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tv-gominho-servir-'));
  const library = path.join(root, 'biblioteca');
  const app = path.join(root, 'app');
  await mkdir(path.join(library, 'programas/dbz/episodios'), { recursive: true });
  await mkdir(path.join(library, '.originais'), { recursive: true });
  await mkdir(path.join(app, 'assets'), { recursive: true });
  for (let i = 0; i < 80; i++) await writeFile(path.join(library, `programas/dbz/episodios/${String(i).padStart(3, '0')} - Episódio.mp4`), Buffer.alloc(1000, i));
  await writeFile(path.join(library, '.originais/escondido.mp4'), 'x');
  await writeFile(path.join(root, 'segredo.txt'), 'fora da biblioteca');
  await writeFile(path.join(app, 'index.html'), '<!doctype html><title>TV</title>');
  await writeFile(path.join(app, 'assets/app.js'), 'console.log(1)');
  await writeFile(path.join(app, 'assets/app.js.br'), 'BROTLI');
  await writeFile(path.join(app, 'assets/app.js.gz'), 'GZIP');

  const server = createLibraryServer(library, app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await close();
  await rm(root, { recursive: true, force: true });
});

describe('createLibraryServer', () => {
  it('lists the library without hidden files, gzipped when asked', async () => {
    const res = await get('/__biblioteca/lista', { 'accept-encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
    const listing = JSON.parse(gunzipSync(res.body).toString('utf8'));
    expect(listing.base).toBe('/__biblioteca/arquivo/');
    expect(listing.files).toHaveLength(80);
    expect(listing.files.some((file: string) => file.includes('.originais'))).toBe(false);
  });

  it('serves byte ranges of library files', async () => {
    const res = await get(`/__biblioteca/arquivo/${encodeURI('programas/dbz/episodios/002 - Episódio.mp4')}`, { range: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 10-19/1000');
    expect([...res.body]).toEqual(Array(10).fill(2));
    expect((await get('/__biblioteca/arquivo/programas/dbz/episodios/000%20-%20Epis%C3%B3dio.mp4', { range: 'bytes=5000-' })).status).toBe(416);
  });

  it('refuses hidden files and paths outside the library', async () => {
    expect((await get('/__biblioteca/arquivo/.originais/escondido.mp4')).status).toBe(404);
    expect((await get('/__biblioteca/arquivo/..%2Fsegredo.txt')).status).toBe(404);
    expect((await get('/__biblioteca/arquivo/%E0%A4%A')).status).toBe(404);
  });

  it('sends the smallest precompressed app file the client accepts', async () => {
    const br = await get('/assets/app.js', { 'accept-encoding': 'gzip, deflate, br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.body.toString()).toBe('BROTLI');
    expect(br.headers['cache-control']).toContain('immutable');
    const gz = await get('/assets/app.js', { 'accept-encoding': 'gzip' });
    expect(gz.body.toString()).toBe('GZIP');
    const plain = await get('/assets/app.js');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe('console.log(1)');
  });

  it('answers app routes with index.html and missing assets with 404', async () => {
    expect((await get('/')).body.toString()).toContain('<title>TV</title>');
    expect((await get('/tv')).body.toString()).toContain('<title>TV</title>');
    expect((await get('/assets/nada.js')).status).toBe(404);
  });
});
