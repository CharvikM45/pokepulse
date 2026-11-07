import Link from "next/link";
import { DevelopmentNotice } from "@pokepulse/ui";
export default function Page() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Collector workspace</h1>
      <DevelopmentNotice />
      <p>Shared application foundation for Developer A and Developer B.</p>
      <ul className="space-y-3">
        <li>
          <Link prefetch={false} href="/api/v1/products">
            Demo product API
          </Link>
        </li>
        <li>
          <Link prefetch={false} href="/api/v1/drops">
            Demo listing API
          </Link>
        </li>
      </ul>
      <p>
        Consumer screens are supplied by Developer B. Account APIs require
        Supabase configuration.
      </p>
    </main>
  );
}
