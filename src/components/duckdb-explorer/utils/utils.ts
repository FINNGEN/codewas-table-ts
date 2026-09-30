import type { BinaryDistribution, DistributionRow, SummaryStats } from "../../../utils/types"
import type { ConceptSummaryRow } from "../types"

export function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return ""
  if (!Number.isFinite(value)) return String(value)
  return value.toFixed(digits)
}

// A p-value of exactly 0 is IEEE-754 underflow, not a true zero: the smallest positive double is
// ~4.94e-324, so any p below that is written as 0 on export. -log10(0) is +Infinity, so every layer
// used to map p = 0 to null - which rendered the *most* significant hits as "N/A", sorted them last
// (NULLS LAST) and dropped them from "> x" filters. Clamp to the underflow ceiling instead: the true
// -log10(p) is at least this large.
export const MAX_NEG_LOG10 = -Math.log10(Number.MIN_VALUE) // ≈ 323.31

export function negLog10(pValue: number | null | undefined): number | null {
  if (pValue == null || Number.isNaN(pValue) || pValue < 0) return null
  return pValue === 0 ? MAX_NEG_LOG10 : -Math.log10(pValue)
}

// Display form of -log10(p). Clamped values print as a lower bound (">323") rather than implying
// two decimals of precision the export never had.
export function formatNegLog10(pValue: number | null | undefined, digits = 2) {
  const value = negLog10(pValue)
  if (value == null) return "N/A"
  return value >= MAX_NEG_LOG10 ? `>${MAX_NEG_LOG10.toFixed(0)}` : formatNumber(value, digits)
}

export function getSafeDownloadName(sourceLabel: string) {
  const baseName = sourceLabel.split("/").at(-1)?.split("\\").at(-1) ?? "codewas_results"
  return baseName.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export function triggerDownload(fileName: string, payload: BlobPart, mimeType: string) {
  const blob = new Blob([payload], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function tsvEscape(value: unknown) {
  if (value == null) return ""
  const text = String(value)
  if (!/[\t\r\n"]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function summaryRowsToTsv(rows: ConceptSummaryRow[]) {
  // The AI review pass is optional, so its two columns are only added when the exported rows
  // actually carry a verdict - an export from a database without the AI tables keeps the header it
  // has always had.
  const includeAi = rows.some((row) => row.aiCategory != null || row.aiRationale != null)
  const exportRows = rows.map((row) => ({
    conceptName: row.conceptName ?? "",
    conceptCode: row.conceptCode ?? "",
    conceptId: row.conceptId,
    ancestorConceptIds: row.ancestorConceptIds ?? "",
    domainId: row.domainId,
    countMode: row.countMode,
    ...(includeAi
      ? { aiCategory: row.aiCategory ?? "", aiRationale: row.aiRationale ?? "" }
      : {}),
    binaryCases: row.binaryCaseYes ?? "",
    binaryControls: row.binaryControlYes ?? "",
    binaryLogP: negLog10(row.binaryPValue) ?? "",
    binaryEffect: row.binaryEffectSize ?? "",
    countsCaseMean: row.countsCaseMean ?? "",
    countsControlMean: row.countsControlMean ?? "",
    countsLogP: negLog10(row.countsPValue) ?? "",
    countsEffect: row.countsEffectSize ?? "",
    ageCaseMean: row.ageCaseMean ?? "",
    ageControlMean: row.ageControlMean ?? "",
    ageLogP: negLog10(row.agePValue) ?? "",
    ageEffect: row.ageEffectSize ?? "",
    daysCaseMean: row.daysCaseMean ?? "",
    daysControlMean: row.daysControlMean ?? "",
    daysLogP: negLog10(row.daysPValue) ?? "",
    daysEffect: row.daysEffectSize ?? "",
    continuousCaseMean: row.continuousCaseMean ?? "",
    continuousControlMean: row.continuousControlMean ?? "",
    continuousUnit: row.continuousUnit ?? "",
    continuousLogP: negLog10(row.continuousPValue) ?? "",
    continuousEffect: row.continuousEffectSize ?? "",
    categoricalCases: row.categoricalCaseYes ?? "",
    categoricalControls: row.categoricalControlYes ?? "",
    categoricalLogP: negLog10(row.categoricalPValue) ?? "",
    categoricalEffect: row.categoricalEffectSize ?? "",
  }))

  const headers = Object.keys(
    exportRows[0] ?? {
      conceptName: "",
      conceptCode: "",
      conceptId: "",
      ancestorConceptIds: "",
      domainId: "",
      countMode: "",
    },
  )
  const lines = [headers.join("\t")]
  exportRows.forEach((row) => {
    lines.push(headers.map((header) => tsvEscape(row[header as keyof typeof row])).join("\t"))
  })
  return lines.join("\n")
}

export function parseCategoricalDistribution(
  value: string | null | undefined,
): BinaryDistribution[] {
  if (!value) return []
  return value
    .split("|")
    .map((part) => {
      const [label, caseValue, controlValue] = part.split("::")
      return {
        value: label,
        case: Number(caseValue ?? 0),
        control: Number(controlValue ?? 0),
      }
    })
    .filter((item) => item.value)
}

export function buildStats(
  caseMean?: number | null,
  controlMean?: number | null,
  caseSd?: number | null,
  controlSd?: number | null,
) {
  if (
    [caseMean, controlMean, caseSd, controlSd].some(
      (value) => value === null || value === undefined,
    )
  ) {
    return null
  }
  return {
    meanValueCases: caseMean as number,
    meanValueControls: controlMean as number,
    sdValueCases: caseSd as number,
    sdValueControls: controlSd as number,
  } satisfies SummaryStats
}

export function buildDistributionRows(
  caseP10?: number | null,
  caseP25?: number | null,
  caseMedian?: number | null,
  caseP75?: number | null,
  caseP90?: number | null,
  controlP10?: number | null,
  controlP25?: number | null,
  controlMedian?: number | null,
  controlP75?: number | null,
  controlP90?: number | null,
) {
  const values: [string, number | null | undefined, number | null | undefined][] = [
    ["P10", caseP10, controlP10],
    ["P25", caseP25, controlP25],
    ["Median", caseMedian, controlMedian],
    ["P75", caseP75, controlP75],
    ["P90", caseP90, controlP90],
  ]
  if (values.every(([, caseValue, controlValue]) => caseValue == null && controlValue == null)) {
    return null
  }
  return values.map(
    ([measure, caseValue, controlValue]) =>
      ({
        Measure: measure,
        Cases: Number(caseValue ?? 0),
        Controls: Number(controlValue ?? 0),
      }) satisfies DistributionRow,
  )
}
