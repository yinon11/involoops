import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";
import {
  countPopulation,
  POPULATION_SOURCES,
  POPULATION_THRESHOLD,
  type PopulationSource,
} from "@/lib/privacy/population";
import { getPopulationSnapshots } from "@/actions/privacy-population-actions";
import { RecordSnapshotButton } from "@/components/admin/privacy-population/record-snapshot-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = {
  title: "Privacy population",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<PopulationSource, string> = {
  users: "Registered users",
  invitations: "Invited by email",
  customers: "Customers (outbound recipients)",
  vendors: "Vendors (inbound issuers)",
  reverseCharge: "Reverse-charge signers",
  outboundRecipients: "Invoice emails with no customer record",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

export default async function PrivacyPopulationPage() {
  const session = await auth();
  if (!session?.user?.id || !(await isUserAdmin(session.user.id))) {
    notFound();
  }

  const snapshots = await getPopulationSnapshots();
  const last = snapshots[0] ?? null;
  const live = await countPopulation(last ? new Date(last.takenAt) : null);
  const delta = last ? live.total - last.totalPeople : null;
  const pct = Math.min(100, (live.total / POPULATION_THRESHOLD) * 100);
  const near = live.total >= POPULATION_THRESHOLD * 0.8;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Privacy population</h1>
        <p className="text-sm text-zinc-500">
          Distinct people whose data the system holds (Privacy Protection Regulations,
          amendment 13). The database stays a &quot;מאגר המנוהל בידי יחיד&quot; below{" "}
          {fmt(POPULATION_THRESHOLD)} people and with no more than two people besides
          the owner having access. Companies are not counted; their contact people are.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">People now</p>
              <p className="text-4xl font-semibold tabular-nums text-zinc-900">
                {fmt(live.total)}
              </p>
              <p className="text-sm text-zinc-500">
                {last ? (
                  <>
                    {signed(delta ?? 0)} since the last snapshot ({fmt(last.totalPeople)} on{" "}
                    {new Date(last.takenAt).toLocaleDateString("en-GB")})
                  </>
                ) : (
                  "No snapshot recorded yet — record one to set the baseline."
                )}
              </p>
            </div>
            <RecordSnapshotButton />
          </div>
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`h-full ${near ? "bg-red-500" : "bg-amber-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className={`mt-1 text-xs ${near ? "text-red-600" : "text-zinc-500"}`}>
              {pct.toFixed(1)}% of the {fmt(POPULATION_THRESHOLD)} threshold
              {near ? " — tell Sasha before it is crossed." : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By source</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-end">People</TableHead>
                <TableHead className="text-end">At last snapshot</TableHead>
                <TableHead className="text-end">Rows added since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {POPULATION_SOURCES.map((s) => (
                <TableRow key={s}>
                  <TableCell>{SOURCE_LABELS[s]}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmt(live.bySource[s])}</TableCell>
                  <TableCell className="text-end tabular-nums text-zinc-500">
                    {last?.breakdown[s] !== undefined ? fmt(last.breakdown[s]) : "—"}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {live.newSince[s] !== undefined ? signed(live.newSince[s]!) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-zinc-500">
            Sources overlap, so they add up to more than the total — the same email or tax
            id counts once. {fmt(live.companyNumberedCustomers)} customers carry a ח.פ.
            (likely companies) and are still counted, because their contact people are.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Snapshot history</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-sm text-zinc-500">No snapshots yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-end">People</TableHead>
                  <TableHead className="text-end">Change</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s, i) => {
                  const prev = snapshots[i + 1];
                  return (
                    <TableRow key={s.id}>
                      <TableCell>{new Date(s.takenAt).toLocaleString("en-GB")}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(s.totalPeople)}</TableCell>
                      <TableCell className="text-end tabular-nums text-zinc-500">
                        {prev ? signed(s.totalPeople - prev.totalPeople) : "—"}
                      </TableCell>
                      <TableCell className="text-zinc-500">{s.takenBy ?? "—"}</TableCell>
                      <TableCell className="text-zinc-500">{s.note ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
