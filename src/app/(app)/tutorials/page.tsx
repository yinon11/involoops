import Link from "next/link";
import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n";
import { tutorials } from "./tutorials";

export const metadata: Metadata = {
  title: "Tutorials",
};

export default async function TutorialsPage() {
  const dict = await getDictionary();
  const t = dict.tutorials;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          The full guide — expenses, issuing, and the Tax Authority — is the{" "}
          <Link href="/developers/guide" className="font-medium text-primary underline">
            user guide
          </Link>
          . These cards are the short walkthroughs. The API is documented separately on{" "}
          <Link href="/developers" className="font-medium text-primary underline">
            the developer docs
          </Link>
          .
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {tutorials.map(({ slug, key }) => {
          const item = t.items[key];
          return (
            <Link
              key={slug}
              href={`/tutorials/${slug}`}
              className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            >
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg group-hover:text-primary">
                    {item.title}
                  </CardTitle>
                  <CardDescription>
                    {format(t.minutes, { count: item.minutes })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.summary}
                  </p>
                  <p className="mt-4 text-sm font-medium text-primary">
                    {t.readMore} →
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
