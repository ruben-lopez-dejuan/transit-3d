import { defineConfig } from "vite";

import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';

function appShell(): Plugin {
  return {
    name: 'transit-app-shell', apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => name.startsWith('assets/')).map((name) => `/${name}`);
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12);
      const paths = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...files];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE='bilbao-transit-${version}';
const PATHS=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PATHS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('bilbao-transit-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match('/'))));return;}
  if(PATHS.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});` });
    },
  };
}

export default defineConfig({
  plugins: [appShell()],
  server: {
    port: 5173,

    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },

    watch: {
      ignored: [
        "**/server/cache/**",
      ],
    },
  },
});
