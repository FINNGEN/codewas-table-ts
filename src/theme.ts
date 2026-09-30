// theme.ts - the app's single source of design tokens.
//
// Palette intent:
//   primary   muted steel blue - the app's own chrome (headers, links, selection)
//   pvalue    violet - reserved for significance/p-value readouts ONLY, so purple
//             always means "this is a p-value" wherever it shows up
//   cases     muted rose  ┐ deliberately low-chroma so a dense table of them stays
//   controls  muted sage  ┘ readable; warm/cool split reads as affected/reference
//   secondary muted amber - the non-standard-concept marker (its only consumer)
//   success / error / warning / info - left at MUI defaults, because those carry
//             real semantics here (clipboard toasts, load errors, alerts)
import {
  createTheme,
  type PaletteColor,
  type PaletteColorOptions,
  type PaletteOptions,
} from "@mui/material/styles"

// Custom palette channels. Without this augmentation `theme.palette.cases` is a type
// error and `sx={{ color: "cases.main" }}` is unchecked - it silently emits the literal
// string as a CSS color when the token is missing (which is what happened in dark mode).
declare module "@mui/material/styles" {
  interface Palette {
    cases: PaletteColor
    controls: PaletteColor
    pvalue: PaletteColor
  }
  interface PaletteOptions {
    cases?: PaletteColorOptions
    controls?: PaletteColorOptions
    pvalue?: PaletteColorOptions
    or: PaletteColorOptions
  }
}

// Lets `<Chip color="pvalue" />` (and cases/controls) type-check and pick up the token.
declare module "@mui/material/Chip" {
  interface ChipPropsColorOverrides {
    cases: true
    controls: true
    pvalue: true
  }
}

/**
 * Raw hues for drawing surfaces that cannot read the theme - canvas 2D contexts and
 * d3 interpolators, which run outside React. Light-scheme values; anything that *can*
 * reach the theme should use `theme.palette.*` instead so it follows the mode toggle.
 */
export const dataHues = {
  primary: "#5082A5",
  pvalue: "#9053C6",
  // Near-white on the pvalue hue - the low end of the heatmap's evidence ramp.
  pvalueFaint: "#F4EEFA",
  cases: "#5458bc",
  casesDark: "#5458bc",
  controls: "#96b2c1",
  controlsDark: "#618194",
} as const

// createTheme only runs augmentColor() on the known channels (primary, secondary, error,
// warning, info, success). Custom channels are passed through verbatim, so cases/controls/
// pvalue must spell out light/dark/contrastText - supplying `main` alone leaves
// `pvalue.light` undefined at runtime with no type error.
const lightPalette: PaletteOptions = {
  mode: "light",
  primary: { main: dataHues.primary, light: "#7BA3BE", dark: "#3A6580", contrastText: "#FFFFFF" },
  secondary: { main: "#A8813F", light: "#C9A76E", dark: "#7E5F2A", contrastText: "#FFFFFF" },
  pvalue: { main: dataHues.pvalue, light: "#B98CDC", dark: "#6B3A9C", contrastText: "#FFFFFF" },
  or: { main: "#FFFFFF" },
  cases: { main: dataHues.cases },
  controls: { main: dataHues.controls },
  background: { default: "#E8F0F9", paper: "#EDF2F7" },
  // Solid, not alpha hex: these sit on paper, on zebra-striped table rows and on tinted
  // chips, and an alpha text color composites differently against each one.
  text: { primary: "#3B5666", secondary: "#6B8494", disabled: "#A3B4BF" },
  divider: "#D3DEE7",
}

const darkPalette: PaletteOptions = {
  mode: "dark",
  primary: { main: "#8DB3CE", light: "#B0CBDE", dark: "#5F8CAA", contrastText: "#0F1A22" },
  secondary: { main: "#D0AB6E", light: "#E3CA9C", dark: "#9E7C42", contrastText: "#1C1610" },
  pvalue: { main: "#BA90DF", light: "#D3B4EC", dark: "#8B5CB5", contrastText: "#17101F" },
  or: { main: "#131A20" },
  cases: { main: dataHues.casesDark },

  controls: { main: dataHues.controlsDark },
  background: { default: "#131A20", paper: "#19222A" },
  text: { primary: "#D3DEE6", secondary: "#93A7B4", disabled: "#5E7280" },
  divider: "#2A3640",
}

/**
 * Every token in one createTheme() call.
 *
 * Both schemes are spelled out under `colorSchemes` rather than as a top-level `palette`:
 * a root `palette` is folded into the *default* scheme only, which left the dark scheme on
 * MUI's stock palette - no `cases`/`controls` at all, and `primary` back to MUI blue.
 * `cssVariables` stays off on purpose: several call sites branch on `theme.palette.mode`
 * (tableColumns, Scatter, DuckDbScatter), and with CSS variables enabled that always
 * reports the default scheme. Enabling it means converting those to theme.applyStyles().
 */
export const appTheme = createTheme({
  colorSchemes: {
    light: { palette: lightPalette },
    dark: { palette: darkPalette },
  },
  typography: {
    fontFamily: [
      "Hack",
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      '"Helvetica Neue"',
      "Arial",
      "sans-serif",
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
    ].join(","),
    fontSize: 11,
  },
  // Global input ergonomics: drop an icon directly inside any Select/MenuItem and it stays
  // aligned in BOTH states. MenuItem is already flex+center by default, so it only needs the
  // icon↔text gap; the CLOSED Select renders the selected value into `.MuiSelect-select`,
  // which isn't flex by default - so that slot needs the same flex/center/gap.
  //
  // Compact sizing lives here too. Every input in the app should be dense by default, which is
  // the theme.components rung of MUI's customization ladder (sx -> styled -> theme -> global)
  // rather than a shared `sx` spread across ~15 call sites. `size="small"` as a defaultProp also
  // catches the chart controls that never passed it (DuckDbHeatmap, DuckDbCharts) and were
  // rendering at the 56px medium height; the padding/font overrides then take small from MUI's
  // 40px down to ~28px.
  components: {
    MuiFormControl: { defaultProps: { size: "small" } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: {
      defaultProps: { size: "small" },
      styleOverrides: {
        // minHeight: MUI pins .MuiSelect-select to 1.4375em, which would hold the box at ~40px no
        // matter how little padding the input has.
        select: { display: "flex", alignItems: "center", gap: 8, minHeight: "unset" },
      },
    },
    MuiInputBase: { styleOverrides: { root: { fontSize: "0.75rem" } } },
    MuiOutlinedInput: { styleOverrides: { input: { paddingTop: 4, paddingBottom: 4 } } },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "0.75rem",
          // An outlined label sits inside the box until it shrinks, and MUI's offset assumes the
          // full-height small input, so it has to come up to match the reduced padding. Scoped to
          // outlined + not-shrunk so filled/standard labels and floating labels stay put.
          "&.MuiInputLabel-outlined:not(.MuiInputLabel-shrink)": {
            transform: "translate(10px, 5px) scale(1)",
          },
        },
      },
    },
    // Toggles too, so the scatter's "Regression line" switch matches the selects beside it.
    MuiSwitch: { defaultProps: { size: "small" } },
    MuiCheckbox: { defaultProps: { size: "small" } },
    // Font only, no minHeight: the open dropdown should match the field's text size, but its rows
    // stay full height so they remain comfortable click targets.
    MuiMenuItem: { styleOverrides: { root: { gap: 8, fontSize: "0.75rem" } } },
  },
})
