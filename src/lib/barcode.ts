/**
 * Scanners disagree about leading zeros: a UPC-A printed as 012345678905 is often reported as
 * the EAN-13 0012345678905. Numeric codes are compared without leading zeros so both match.
 */
export function barcodeKey(code: string): string {
  const c = code.trim()
  return /^\d{8,14}$/.test(c) ? c.replace(/^0+/, '') : c
}

export function findByBarcode<T extends { barcode?: string }>(items: T[], code: string): T | undefined {
  const key = barcodeKey(code)
  if (!key) return undefined
  return items.find((i) => i.barcode && barcodeKey(i.barcode) === key)
}
