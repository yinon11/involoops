/**
 * Dashboard UI tunables. Kept colocated with the dashboard components so
 * they're easy to find; promote to a global config if they grow.
 */

/**
 * Maximum number of vendor slices shown on the donut chart. When the filtered
 * vendor count exceeds this, the smallest vendors are collapsed into a single
 * "Other" slice (top `MAX_VENDOR_SLICES - 1` + "Other").
 *
 * Eight, matching the validated categorical palette. It used to be 50, which
 * meant a ninth vendor onward drew a *generated* colour: past the first
 * rotation neighbouring vendors were indistinguishable, and forty hairline
 * slices are unreadable regardless of colour. Nothing is lost — the "Other"
 * slice is clickable and filters the dashboard to exactly those vendors, and
 * the invoice table below always lists every one of them.
 */
export const MAX_VENDOR_SLICES = 8;

/** Legend items per page on desktop. */
export const LEGEND_PAGE_SIZE_DESKTOP = 8;

/** Legend items per page on mobile. */
export const LEGEND_PAGE_SIZE_MOBILE = 5;

/**
 * Comparison chart (compare mode only) — how many vendors to show from
 * each "zone". Common vendors are ranked by absolute delta |B − A|
 * descending; unique vendors are ranked by their own total descending.
 * Tune freely if the chart becomes too dense or too sparse.
 */
export const VENDOR_COMPARE_TOP_COMMON = 15;
export const VENDOR_COMPARE_TOP_UNIQUE_PER_SIDE = 5;
