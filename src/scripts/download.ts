import type { DownloadKind } from '../lib/download-metrics';

export function downloadFile(name: string, blob: Blob, kind: DownloadKind) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  window.dispatchEvent(new CustomEvent('lumassets:download', { detail: kind }));
  void fetch(`/api/downloads?kind=${kind}`, { method: 'POST', credentials: 'omit', keepalive: true })
    .catch(() => { /* A failed count must never interrupt the download. */ });
}
