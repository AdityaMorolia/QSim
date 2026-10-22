function activated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', changed);
      if (error) reject(error); else resolve();
    };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('Offline installation failed'));
    };
    const timeout = setTimeout(() => finish(new Error('Offline installation timed out')), 60_000);
    worker.addEventListener('statechange', changed);
    changed();
  });
}

function saved(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Offline check timed out'));
    }, 10_000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data?.ready === true);
    };
    worker.postMessage({ type: 'offline-status' }, [channel.port2]);
  });
}

async function saveOffline(): Promise<void> {
  // Both screens replace #app while rendering; keep this small notice outside it.
  const status = document.createElement('div');
  status.className = 'offline-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Saving for offline use…';
  document.body.append(status);
  let failure = 'Offline saving unavailable · reconnect and reload on HTTPS';
  try {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      throw new Error('Offline saving requires a supported browser and HTTPS (or localhost)');
    }
    const scope = new URL('./', location.href);
    let registration = await navigator.serviceWorker.getRegistration(scope.href);
    if (registration?.scope !== scope.href) registration = undefined;
    try {
      registration = await navigator.serviceWorker.register(new URL('sw.js', scope), { updateViaCache: 'none' });
    } catch (error) {
      // Reopening offline must still recognize an already-installed copy.
      if (!registration?.active) throw error;
    }
    const worker = registration.active ?? registration.installing ?? registration.waiting;
    if (!worker) throw new Error('No offline worker');
    await activated(worker);
    if (!await saved(worker)) {
      failure = 'Offline copy incomplete · clear this site’s data and reopen online (saved progress will be lost)';
      throw new Error('Offline files are incomplete');
    }
    status.textContent = 'Available offline';
    status.dataset.state = 'ready';
    setTimeout(() => status.remove(), 8_000);
    // This is best-effort: denial does not invalidate the saved copy.
    void navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    status.textContent = failure;
    status.dataset.state = 'error';
    console.warn('Offline saving unavailable:', error);
  }
}

// Keep service workers out of the development server and hot reload workflow.
if (import.meta.env.PROD) void saveOffline();
