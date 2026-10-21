// Frontend logic (AG Grid community custom cell renderers + drawer) lands in D4
// (Master Spec §7.1). For now, surface gateway liveness in the footer.

const health = document.getElementById('health');
fetch('/api/v1/health')
  .then((r) => r.json())
  .then((j) => { health.textContent = j.status === 'ok' ? 'online' : 'unknown'; })
  .catch(() => { health.textContent = 'offline'; });
