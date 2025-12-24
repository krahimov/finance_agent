import { desc } from "drizzle-orm";
import Link from "next/link";

import { getDb } from "@/lib/db/client";
import { documents, extractionRuns } from "@/lib/db/schema";

import { IngestionForm } from "./IngestionForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  let recentDocs: Array<{
    id: string;
    cik: string;
    docType: string;
    accessionNo: string;
    filingDate: unknown;
    url: string;
    createdAt: unknown;
  }> = [];

  let recentRuns: Array<{
    id: string;
    model: string;
    promptVersion: string;
    startedAt: Date;
    finishedAt: Date | null;
  }> = [];

  let dbError: string | null = null;

  try {
    const db = getDb();

    recentDocs = await db
      .select({
        id: documents.id,
        cik: documents.cik,
        docType: documents.docType,
        accessionNo: documents.accessionNo,
        filingDate: documents.filingDate,
        url: documents.url,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(20);

    recentRuns = await db
      .select({
        id: extractionRuns.id,
        model: extractionRuns.model,
        promptVersion: extractionRuns.promptVersion,
        startedAt: extractionRuns.startedAt,
        finishedAt: extractionRuns.finishedAt,
      })
      .from(extractionRuns)
      .orderBy(desc(extractionRuns.startedAt))
      .limit(20);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="space-y-1">
          <nav className="mb-6 flex items-center gap-3 text-sm">
            <Link className="font-medium underline-offset-4 hover:underline" href="/">
              Chat
            </Link>
            <span className="text-zinc-400">/</span>
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href="/ingestion"
            >
              Ingestion
            </Link>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight">
            Ingestion &amp; Extraction
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Trigger EDGAR ingestion and extraction runs, and inspect recent activity.
          </p>
        </header>

        <section className="mt-8">
          <IngestionForm />
        </section>

        {dbError ? (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Database not configured
            </div>
            <div className="mt-2">
              This page needs Postgres to list recent documents and extraction runs. Current error:
            </div>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-amber-100/60 p-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
              {dbError}
            </pre>
            <div className="mt-3">
              On Vercel, set <span className="font-mono">DATABASE_URL</span> (and other required env vars) for the{" "}
              <span className="font-medium">Production</span> and <span className="font-medium">Preview</span>{" "}
              environments, then redeploy.
            </div>
          </div>
        ) : null}

        <section className="mt-12 space-y-3">
          <h2 className="text-lg font-semibold">Recent documents</h2>
          <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3">Document ID</th>
                  <th className="px-4 py-3">CIK</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Accession</th>
                  <th className="px-4 py-3">Filed</th>
                </tr>
              </thead>
              <tbody>
                {recentDocs.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{d.id}</td>
                    <td className="px-4 py-3">{d.cik}</td>
                    <td className="px-4 py-3">{d.docType}</td>
                    <td className="px-4 py-3 font-mono text-xs">{d.accessionNo}</td>
                    <td className="px-4 py-3">{String(d.filingDate)}</td>
                  </tr>
                ))}
                {recentDocs.length === 0 ? (
                  <tr>
                    <td
                      className="px-4 py-6 text-sm text-zinc-500"
                      colSpan={5}
                    >
                      No documents yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 space-y-3">
          <h2 className="text-lg font-semibold">Recent extraction runs</h2>
          <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3">Run ID</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Prompt</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Finished</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                    <td className="px-4 py-3">{r.model}</td>
                    <td className="px-4 py-3">{r.promptVersion}</td>
                    <td className="px-4 py-3">{r.startedAt.toISOString()}</td>
                    <td className="px-4 py-3">
                      {r.finishedAt ? r.finishedAt.toISOString() : "—"}
                    </td>
                  </tr>
                ))}
                {recentRuns.length === 0 ? (
                  <tr>
                    <td
                      className="px-4 py-6 text-sm text-zinc-500"
                      colSpan={5}
                    >
                      No extraction runs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}


