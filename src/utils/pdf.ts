/**
 * Minimal PDF writer for plain-text reports. Hand-rolled on purpose, matching
 * csv.ts's precedent — no new dependency for a single export feature (#538).
 *
 * Builds a valid single/multi-page PDF (Letter size, base-14 Helvetica, no
 * font embedding needed) directly from an array of text lines.
 */

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 48
const FONT_SIZE = 10
const LINE_HEIGHT = 14
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT)

/** Escape characters PDF's literal-string syntax treats specially. */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Render a title and body lines as a paginated PDF document.
 * @returns a Buffer ready to be sent as `application/pdf`.
 */
export function toSimplePdf(title: string, lines: string[]): Buffer {
  const pages = chunk(lines, LINES_PER_PAGE - 2) // reserve 2 lines for the title/spacer on page 1
  if (pages.length === 0) pages.push([])

  const objects: string[] = []
  const pageObjNums: number[] = []
  const contentObjNums: number[] = []

  // Object 1: Catalog, Object 2: Pages (filled in after we know page object numbers).
  // Object 3: Font. Page + content objects follow.
  const FONT_OBJ = 3
  let nextObj = 4

  const pageIds: number[] = pages.map(() => nextObj++)
  const contentIds: number[] = pages.map(() => nextObj++)
  pageObjNums.push(...pageIds)
  contentObjNums.push(...contentIds)

  pages.forEach((pageLines, i) => {
    const streamLines: string[] = []
    let y = PAGE_HEIGHT - MARGIN
    streamLines.push(`BT /F1 ${FONT_SIZE} Tf ${MARGIN} ${y} Td`)
    if (i === 0) {
      streamLines.push(`(${escapePdfText(title)}) Tj 0 -${LINE_HEIGHT * 1.5} Td`)
    }
    for (const line of pageLines) {
      streamLines.push(`(${escapePdfText(line)}) Tj 0 -${LINE_HEIGHT} Td`)
    }
    streamLines.push('ET')
    const stream = streamLines.join('\n')

    objects[contentIds[i]! - 1] =
      `<< /Length ${Buffer.byteLength(stream, 'utf-8')} >>\nstream\n${stream}\nendstream`
    objects[pageIds[i]! - 1] =
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${FONT_OBJ} 0 R >> >> /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentIds[i]} 0 R >>`
  })

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf-8'))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf-8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return Buffer.from(pdf, 'utf-8')
}
