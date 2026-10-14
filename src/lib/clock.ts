/**
 * Reading the wall clock, as an awaited call.
 *
 * `react-hooks`'s purity rule objects to `Date.now()` during render, and it
 * is right to: a component that reads the clock mid-render can disagree
 * with itself across a re-render, and in a server component the value then
 * travels to the client as if it were data. Awaiting the read makes it an
 * explicit side-effect at a known point, which is also honest
 * documentation of what it is.
 *
 * This lived as a private copy in two page files before a third caller
 * needed it. One copy, so the reasoning above does not have to be
 * rediscovered each time.
 */
export async function readClock(): Promise<{ nowMs: number }> {
  return { nowMs: Date.now() };
}
