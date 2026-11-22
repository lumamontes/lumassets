export const DOWNLOAD_LABELS = {
  'library-svg': 'Drawing SVG',
  'library-png': 'Drawing PNG',
  'library-zip': 'Library ZIP',
  'compose-png': 'Composition PNG',
  'compose-svg': 'Composition SVG',
  'compose-json': 'Editable composition',
} as const;

export type DownloadKind = keyof typeof DOWNLOAD_LABELS;
