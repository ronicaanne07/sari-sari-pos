/**
 * Reads a barcode from a live <video>. Uses the phone's built-in BarcodeDetector when there is one
 * (Chrome on Android: fast, no download) and otherwise ZXing, loaded only when first needed
 * (iPhone Safari, desktop browsers).
 */

export interface Detector {
  kind: 'native' | 'zxing'
  /** Returns the code in the current frame, or null when there is none. */
  detect(video: HTMLVideoElement): Promise<string | null>
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
interface NativeDetectorCtor {
  new (options?: { formats: string[] }): NativeDetector
  getSupportedFormats?: () => Promise<string[]>
}

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']

async function createZxingDetector(): Promise<Detector> {
  const z = await import('@zxing/library')
  const hints = new Map<unknown, unknown>()
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [
    z.BarcodeFormat.EAN_13,
    z.BarcodeFormat.EAN_8,
    z.BarcodeFormat.UPC_A,
    z.BarcodeFormat.UPC_E,
    z.BarcodeFormat.CODE_128,
    z.BarcodeFormat.CODE_39,
    z.BarcodeFormat.ITF,
    z.BarcodeFormat.QR_CODE,
  ])
  hints.set(z.DecodeHintType.TRY_HARDER, true)
  const reader = new z.MultiFormatReader()
  reader.setHints(hints as Map<import('@zxing/library').DecodeHintType, unknown>)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')

  return {
    kind: 'zxing',
    async detect(video) {
      if (!video.videoWidth || !video.videoHeight) return null
      // Decoding a smaller frame is much faster and plenty sharp for a barcode held close.
      const scale = Math.min(1, 800 / video.videoWidth)
      const w = Math.round(video.videoWidth * scale)
      const h = Math.round(video.videoHeight * scale)
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)
      const gray = new Uint8ClampedArray(w * h)
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
      }
      const bitmap = new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(gray, w, h)))
      try {
        return reader.decode(bitmap).getText()
      } catch (e) {
        // "no barcode in this frame" is normal; anything else is a real error
        if (
          e instanceof z.NotFoundException ||
          e instanceof z.ChecksumException ||
          e instanceof z.FormatException
        ) {
          return null
        }
        throw e
      }
    },
  }
}

export async function createDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats?.()
      const formats = supported ? NATIVE_FORMATS.filter((f) => supported.includes(f)) : NATIVE_FORMATS
      if (formats.length > 0) {
        const native = new Native({ formats })
        let fallback: Detector | null = null
        return {
          kind: 'native',
          async detect(video) {
            if (fallback) return fallback.detect(video)
            try {
              const found = await native.detect(video)
              return found[0]?.rawValue ?? null
            } catch {
              // Some phones expose the API but fail at runtime: switch to ZXing for good.
              fallback = await createZxingDetector()
              return fallback.detect(video)
            }
          },
        }
      }
    } catch {
      /* fall through to ZXing */
    }
  }
  return createZxingDetector()
}
