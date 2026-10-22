import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), `${name}/`));
    else if (entry.isFile() && name !== 'sw.js') files.push(name);
  }
  return files;
}

const files = (await listFiles(dist)).sort();
for (const page of ['index.html', 'display.html']) {
  if (!files.includes(page)) throw new Error(`Offline build requires dist/${page}.`);
}
const hash = createHash('sha256');
for (const name of files) {
  const contents = await readFile(join(dist, name));
  hash.update(name).update('\0').update(String(contents.length)).update('\0').update(contents);
}
const version = hash.digest('hex');
const paths = files.map(name => name.split('/').map(encodeURIComponent).join('/'));

// Generate after Vite so both pages and every emitted asset share one version.
await writeFile(join(dist, 'sw.js'), `const PREFIX = 'quantum-playground-offline:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + ${JSON.stringify(version)};
const URLS = ${JSON.stringify(paths)}.map(path => new URL(path, self.registration.scope).href);
const OWNED = new Set(URLS);
const INDEX = new URL('index.html', self.registration.scope).href;

async function isReady() {
  // CacheStorage.match checks this cache without creating it if it is missing.
  const entries = await Promise.all(URLS.map(url => caches.match(url, { cacheName: CACHE })));
  return entries.every(Boolean);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (await isReady()) return;
    const cache = await caches.open(CACHE);
    // addAll commits the complete set together; a missing file rejects installation.
    await cache.addAll(URLS.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)),
  )));
  // Let open tabs finish with their existing worker; do not claim or force updates.
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  url.search = ''; url.hash = '';
  const key = url.href === self.registration.scope ? INDEX : url.href;
  if (!OWNED.has(key)) return;
  // Only declared files use the cache; network fallbacks never mutate this version.
  event.respondWith(caches.match(key, { cacheName: CACHE }).then(cached => cached || fetch(event.request)));
});

self.addEventListener('message', event => {
  const port = event.ports[0];
  if (event.data?.type !== 'offline-status' || !port) return;
  event.waitUntil(isReady().catch(() => false).then(ready => port.postMessage({ ready })));
});
`);
console.log(`Offline cache: ${files.length} files (${version.slice(0, 12)}).`);
