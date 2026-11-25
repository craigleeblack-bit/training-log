/** One code read from a camera frame or a picture. */
export interface Scanned {
  /** "qr_code", "code_128", "ean_13"… */
  format: string;
  text: string;
}

interface Detector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

interface NativeDetector {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let ready: Promise<Detector> | undefined;

/**
 * The browser's own detector where it has one that reads QR codes (Chrome on Android), otherwise
 * a WebAssembly reader loaded only when first needed. The reader's file ships with the app, so
 * scanning works offline and nothing is fetched from elsewhere.
 */
async function load(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
  if (Native) {
    try {
      const formats = await Native.getSupportedFormats();
      if (formats.includes('qr_code')) return new Native({ formats });
    } catch {
      /* fall through to the bundled reader */
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path),
    },
  });
  return new BarcodeDetector() as Detector;
}

/** Every code visible in a video frame, image or canvas. Empty when there is none. */
export async function detectCodes(source: ImageBitmapSource): Promise<Scanned[]> {
  ready ??= load();
  let detector: Detector;
  try {
    detector = await ready;
  } catch (err) {
    ready = undefined; // let a later attempt try again, such as once back online
    throw err;
  }
  const found = await detector.detect(source);
  return found.filter((f) => f.rawValue).map((f) => ({ format: f.format, text: f.rawValue }));
}

/** Read the codes in a photo or screenshot. */
export async function decodeFile(file: Blob): Promise<Scanned[]> {
  const bitmap = await createImageBitmap(file);
  try {
    return await detectCodes(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Formats that can be redrawn sharply from their text; anything else is kept as a picture. */
const LINEAR: Record<string, string> = {
  code_128: 'CODE128',
  code_39: 'CODE39',
  ean_13: 'EAN13',
  ean_8: 'EAN8',
  upc_a: 'UPC',
  itf: 'ITF',
  codabar: 'codabar',
};

export const isQr = (format?: string): boolean => !format || format === 'qr_code';

/** The JsBarcode name for a scanned linear format, if it can be drawn. */
export const linearFormat = (format?: string): string | undefined => (format ? LINEAR[format] : undefined);

export const canRedraw = (format: string): boolean => isQr(format) || !!LINEAR[format];

/** A web address the code points at, when it is one. */
export function linkIn(text: string): string | undefined {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
