import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material"
import { CategoryBar, CategoricalDistributionBar, MeanComparisonChart } from "../Visuals"
import type { ConceptSummaryRow } from "./types"
import {
  buildDistributionRows,
  buildStats,
  formatNegLog10,
  formatNumber,
  parseCategoricalDistribution,
} from "./utils/utils"
import { CopyButton } from "./UI/CopyButton"
import { useClipboard } from "./context/ClipboardContext"

function renderTestSummary(
  _label: string,
  pValue?: number | null,
  effectSize?: number | null,
  smd?: number | null,
  testName?: string | null,
) {
  if (pValue == null && effectSize == null && smd == null && !testName) return null
  return (
    <Stack spacing={0.25}>
      {/* <Typography variant="subtitle2">{label}</Typography> */}
      <Typography variant="body2" color="text.secondary">
        -log10(p): {formatNegLog10(pValue, 2)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Effect: {effectSize == null ? "N/A" : formatNumber(effectSize, 2)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        SD effect: {smd == null ? "N/A" : formatNumber(smd, 2)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Test: {testName ?? "N/A"}
      </Typography>
    </Stack>
  )
}

type AnalysisSectionKey = "binary" | "categorical" | "counts" | "age" | "days" | "continuous"

// Interpretation guidance shown beside each result. Case/control directions follow the
// statistical calculations in CodeWAS.
const ANALYSIS_DESCRIPTIONS: Record<AnalysisSectionKey, string> = {
  binary:
    "Compares the proportion with at least one record (Fisher's exact or chi-square test). Effect is the odds ratio (cases / controls): values above 1 mean the concept is more common in cases; values below 1 mean it is less common. SD effect is the standardized prevalence difference: (case prevalence - control prevalence) / pooled prevalence SD.",
  categorical:
    "Compares the distribution across categories (Fisher's exact or chi-square test). Effect and SD effect are Cramer's V, a 0-1 measure of how different category proportions are between cases and controls. 0 means the cohorts have the same category distribution; values closer to 1 mean the distributions are more different. Use the distribution bars to see which categories differ.",
  counts:
    "Compares the average number of records per person (negative-binomial test). Effect is the incidence rate ratio (IRR; case mean / control mean): values above 1 mean more records in cases; values below 1 mean fewer. SD effect is the count mean difference divided by the pooled person-level count SD.",
  age:
    "Compares age at first record among people with a record (Welch two-sample t-test). Effect is case mean minus control mean, in years: positive means a later age in cases and negative means an earlier age. SD effect is (case mean - control mean) / pooled SD. Only people with a recorded event contribute to this comparison.",
  days:
    "Compares days from cohort entry to first record among people with a record (Welch two-sample t-test). Effect is case mean minus control mean, in days: positive means later in cases and negative means earlier. SD effect is (case mean - control mean) / pooled SD. Only people with a recorded event contribute to this comparison.",
  continuous:
    "Compares recorded numeric values among people with a value (Welch two-sample t-test). Effect is case mean minus control mean in the displayed unit: positive means higher values in cases and negative means lower. SD effect is (case mean - control mean) / pooled SD.",
}

// Every analysis card shares the same shell: a title, the results on the left, and the description
// on the right.
function AnalysisCard({
  title,
  sectionKey,
  children,
}: {
  title: string
  sectionKey: AnalysisSectionKey
  children: ReactNode
}) {
  const description = ANALYSIS_DESCRIPTIONS[sectionKey]
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Stack spacing={1}>
        <Typography variant="h6">{title}</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 7 }}>
            <Stack spacing={1}>{children}</Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              {description}
            </Typography>
          </Grid>
        </Grid>
      </Stack>
    </Paper>
  )
}

const CopyableEntry = ({ label, value }: { label: string; value: string | number }) => {
  const { copy } = useClipboard()
  return (
    <Typography
      variant="body2"
      onClick={() => copy(String(value))}
      sx={{ ":hover": { cursor: "copy", backgroundColor: "action.hover" } }}
    >
      <b>{label}: </b>
      {value}
      {/* <CopyButton value={value} /> */}
    </Typography>
  )
}

export function ConceptDetailDialog({
  row,
  onClose,
}: {
  row: ConceptSummaryRow | null
  onClose: () => void
}) {
  if (!row) return null

  const binaryDistribution =
    row.binaryCaseYes != null &&
    row.binaryControlYes != null &&
    row.binaryTotalCases != null &&
    row.binaryTotalControls != null ? (
      <CategoryBar
        caseCount={row.binaryCaseYes}
        controlCount={row.binaryControlYes}
        totalCases={row.binaryTotalCases}
        totalControls={row.binaryTotalControls}
      />
    ) : null

  const categoricalDistribution = row.categoricalDistribution
    ? parseCategoricalDistribution(row.categoricalDistribution)
    : []

  const continuousSections: Array<{
    title: string
    prefix: "counts" | "age" | "days" | "continuous"
    unit?: string
  }> = [
    { title: "Counts", prefix: "counts" },
    { title: "Age First Event", prefix: "age" },
    { title: "Days To First Event", prefix: "days" },
    { title: "Continuous", prefix: "continuous", unit: row.continuousUnit ?? "" },
  ]

  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="lg" fullWidth>
      <Stack direction={"row"}>
        <DialogTitle sx={{ color: "primary.main" }}>
          {row.conceptName ?? row.conceptId}
          <CopyButton value={row.conceptName ?? row.conceptId} />
        </DialogTitle>
      </Stack>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack spacing={0}>
            <CopyableEntry label="Source code" value={row.conceptCode ?? "N/A"} />
            <CopyableEntry label="Concept ID" value={row.conceptId} />
            <CopyableEntry label="Domain" value={row.domainId} />
            <CopyableEntry label="Count mode" value={row.countMode} />
            <CopyableEntry
              label="Ancestors"
              value={row.ancestorConceptIds ? row.ancestorConceptIds.split(",").join(", ") : "N/A"}
            />
          </Stack>

          <Grid container spacing={1}>
            <Grid size={{ xs: 12, md: 6 }}>
              <AnalysisCard title="Binary" sectionKey="binary">
                {binaryDistribution ?? (
                  <Typography variant="body2">No binary distribution available.</Typography>
                )}
                {renderTestSummary(
                  "Binary statistics",
                  row.binaryPValue,
                  row.binaryEffectSize,
                  row.binarySmd,
                  row.binaryTestName,
                )}
              </AnalysisCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <AnalysisCard title="Categorical" sectionKey="categorical">
                {categoricalDistribution.length > 0 ? (
                  <CategoricalDistributionBar
                    totalCases={row.categoricalCaseYes ?? 0}
                    totalControls={row.categoricalControlYes ?? 0}
                    distributions={categoricalDistribution}
                  />
                ) : (
                  <Typography variant="body2">No categorical distribution available.</Typography>
                )}
                {renderTestSummary(
                  "Categorical statistics",
                  row.categoricalPValue,
                  row.categoricalEffectSize,
                  row.categoricalSmd,
                  row.categoricalTestName,
                )}
              </AnalysisCard>
            </Grid>
            {continuousSections.map((section) => {
              const stats = buildStats(
                row[`${section.prefix}CaseMean` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}ControlMean` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}CaseSd` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}ControlSd` as keyof ConceptSummaryRow] as number | null,
              )
              const distributions = buildDistributionRows(
                row[`${section.prefix}P10Case` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P25Case` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}MedianCase` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P75Case` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P90Case` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P10Control` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P25Control` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}MedianControl` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P75Control` as keyof ConceptSummaryRow] as number | null,
                row[`${section.prefix}P90Control` as keyof ConceptSummaryRow] as number | null,
              )
              return (
                <Grid key={section.prefix} size={{ xs: 12, md: 6 }}>
                  <AnalysisCard title={section.title} sectionKey={section.prefix}>
                    {stats && distributions ? (
                      <MeanComparisonChart
                        stats={stats}
                        distributions={distributions}
                        unit={section.unit ?? ""}
                      />
                    ) : (
                      <Typography variant="body2">No summary distribution available.</Typography>
                    )}
                    {renderTestSummary(
                      `${section.title} statistics`,
                      row[`${section.prefix}PValue` as keyof ConceptSummaryRow] as number | null,
                      row[`${section.prefix}EffectSize` as keyof ConceptSummaryRow] as
                        | number
                        | null,
                      row[`${section.prefix}Smd` as keyof ConceptSummaryRow] as number | null,
                      row[`${section.prefix}TestName` as keyof ConceptSummaryRow] as string | null,
                    )}
                  </AnalysisCard>
                </Grid>
              )
            })}
          </Grid>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
