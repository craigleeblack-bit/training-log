/** Largest PNG kept as-is; bigger pictures are stored as JPEG instead. About half a megabyte. */
const PNG_LIMIT = 700_000;

/**
 * A picture as text that can sit in the database and in a backup file, scaled down so that its
 * longest side is at most `max` pixels. Screenshots of codes stay PNG, which keeps their edges sharp.
 */
export async function toDataUrl(source: Blob | HTMLVideoElement, max = 1600): Promise<string> {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : undefined;
  const width = bitmap?.width ?? (source as HTMLVideoElement).videoWidth;
  const height = bitmap?.height ?? (source as HTMLVideoElement).videoHeight;
  const scale = Math.min(1, max / Math.max(width, height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process pictures.');
  ctx.drawImage(bitmap ?? (source as HTMLVideoElement), 0, 0, canvas.width, canvas.height);
  bitmap?.close();
  const png = canvas.toDataURL('image/png');
  return png.length <= PNG_LIMIT ? png : canvas.toDataURL('image/jpeg', 0.9);
}
