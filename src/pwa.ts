type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export function setupPwa(title: string) {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => { /* App remains usable without installation. */ }); });
  }
  const button = document.createElement('button'); button.className = 'text-button'; button.hidden = true; button.textContent = '↓ Instalar ' + title;
  document.querySelector('#layers')?.append(button);
  let pending: InstallEvent | null = null;
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); pending = event as InstallEvent; button.hidden = false; });
  button.onclick = async () => { if (!pending) return; await pending.prompt(); await pending.userChoice; pending = null; button.hidden = true; };
  window.addEventListener('appinstalled', () => { button.hidden = true; pending = null; });
}
