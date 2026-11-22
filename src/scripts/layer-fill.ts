// Flood the transparent pixels connected to the outside. The remaining transparent
// regions are enclosed by ink and can be painted underneath the original drawing.
export function enclosedFill(image: HTMLImageElement, width: number, height: number, color: string): string {
  const scale = 1400 / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const w = canvas.width + 2, h = canvas.height + 2;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(-1, -1, w, h).data;
  const outside = new Uint8Array(w * h);
  const queue = new Uint32Array(w * h);
  let end = 0;
  const visit = (i: number) => {
    if (outside[i] || pixels[i * 4 + 3] >= 96) return;
    outside[i] = 1;
    queue[end++] = i;
  };
  visit(0);
  for (let start = 0; start < end; start++) {
    const i = queue[start];
    if (i % w) visit(i - 1);
    if (i % w !== w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  }

  const fill = ctx.createImageData(canvas.width, canvas.height);
  const rgb = Number.parseInt(color.slice(1), 16);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y + 1) * w + x + 1;
      if (outside[i] || pixels[i * 4 + 3] === 255) continue;
      const j = (y * canvas.width + x) * 4;
      fill.data[j] = rgb >> 16;
      fill.data[j + 1] = (rgb >> 8) & 255;
      fill.data[j + 2] = rgb & 255;
      fill.data[j + 3] = 255;
    }
  }
  ctx.putImageData(fill, 0, 0);
  return canvas.toDataURL();
}
