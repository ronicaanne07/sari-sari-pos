import { RECEIPT_WIDTH, type ReceiptLine } from './receipt'

const FONT = 'ui-monospace, "Courier New", Menlo, Consolas, monospace'

/**
 * Draws the receipt as a PNG (for sharing to Messenger/Viber/SMS or saving).
 * Every character sits on a fixed grid, so columns stay aligned even if the font
 * falls back to a different one for the ₱ sign.
 */
export function renderReceiptPng(lines: ReceiptLine[]): Promise<Blob> {
  const fontPx = 20
  const lineH = 27
  const margin = 20
  const scale = 2

  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return Promise.reject(new Error('Canvas is not available'))
  probe.font = `${fontPx}px ${FONT}`
  const charW = probe.measureText('M').width

  const width = Math.ceil(charW * RECEIPT_WIDTH + margin * 2)
  const height = margin * 2 + lines.length * lineH
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas is not available'))

  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'middle'

  lines.forEach((line, i) => {
    ctx.font = `${line.bold ? 'bold ' : ''}${fontPx}px ${FONT}`
    const y = margin + i * lineH + lineH / 2
    for (let c = 0; c < line.text.length; c++) {
      const ch = line.text[c]
      if (ch !== ' ') ctx.fillText(ch, margin + c * charW, y)
    }
  })

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'),
  )
}
