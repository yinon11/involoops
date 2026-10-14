"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Search, X, ArrowRight } from "lucide-react";
import { format } from "@/lib/i18n";

export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  invoiceCount: number;
}

interface Labels {
  searchPlaceholder: string;
  clear: string;
  noResults: string;
  totalCountTemplate: string;
  cols: {
    name: string;
    email: string;
    phone: string;
    taxId: string;
    invoices: string;
  };
}

export function CustomerListClient({
  customers,
  labels,
}: {
  customers: CustomerRow[];
  labels: Labels;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.taxId ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [customers, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            className="ps-9"
            aria-label={labels.searchPlaceholder}
          />
        </div>
        {query.trim() && (
          <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
            <X className="me-1 h-4 w-4" />
            {labels.clear}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.cols.name}</TableHead>
                <TableHead>{labels.cols.email}</TableHead>
                <TableHead>{labels.cols.phone}</TableHead>
                <TableHead>{labels.cols.taxId}</TableHead>
                <TableHead className="text-end">
                  {labels.cols.invoices}
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    {labels.noResults}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/customers/${c.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/customers/${c.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.email ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.phone ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.taxId ?? "—"}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {c.invoiceCount}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {format(labels.totalCountTemplate, { count: filtered.length })}
      </p>
    </div>
  );
}
