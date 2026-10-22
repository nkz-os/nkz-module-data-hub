/**
 * Composite uPlot canvases into a single PNG image.
 * uPlot uses multiple canvas layers (u-under for grid/axes, u-over for data).
 * We draw them in order onto an offscreen canvas, then copy to clipboard.
 */
export async function copyChartToClipboard(
  container: HTMLDivElement
): Promise<{ success: boolean; message: string }> {
  const canvases = container.querySelectorAll('canvas');
  if (canvases.length === 0) return { success: false, message: 'No canvas found' };

  let maxW = 0, maxH = 0;
  for (const c of canvases) {
    if (c.width > maxW) maxW = c.width;
    if (c.height > maxH) maxH = c.height;
  }
  if (maxW === 0 || maxH === 0) return { success: false, message: 'Canvas has zero dimensions' };

  const offscreen = document.createElement('canvas');
  offscreen.width = maxW;
  offscreen.height = maxH;
  const ctx = offscreen.getContext('2d')!;

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, maxW, maxH);

  for (const c of canvases) {
    ctx.drawImage(c, 0, 0);
  }

  try {
    const blob = await new Promise<Blob>((resolve, reject) =>
      offscreen.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    );
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    return { success: true, message: 'Copied to clipboard' };
  } catch {
    // Fallback: trigger download
    const blob = await new Promise<Blob>((resolve) =>
      offscreen.toBlob((b) => resolve(b!), 'image/png')
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datahub-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true, message: 'Downloaded (clipboard unavailable)' };
  }
}
