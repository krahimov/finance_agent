import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Link from "next/link";

import { getDb } from "@/lib/db/client";
import { entities } from "@/lib/db/schema";
import { getCitationsByAssertionIds } from "@/lib/retrieval/citations";
import { factsQuery } from "@/lib/retrieval/facts";
import { graphTraverse } from "@/lib/retrieval/graph";

export const runtime = "nodejs";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export default async function EntityPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  if (!isUuid(id)) notFound();

  const db = getDb();
  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      identifiers: entities.identifiers,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);

  if (rows.length === 0) notFound();
  const entity = rows[0];

  const [facts, neighborhood] = await Promise.all([
    factsQuery({ subjectEntityId: id, status: "active", limit: 50 }),
    graphTraverse({ seedEntityIds: [id], depth: 2, limit: 40 }),
  ]);

  const topAssertionIds = facts.slice(0, 10).map((f) => f.id);
  const citations = topAssertionIds.length
    ? await getCitationsByAssertionIds(topAssertionIds)
    : [];
  const citationByAssertionId = new Map(
    citations.map((c) => [c.assertionId, c.citation]),
  );

  const nodeNameById = new Map<string, string>();
  for (const n of neighborhood.nodes) {
    const name = String(n.properties?.["name"] ?? n.properties?.["canonicalName"] ?? n.id);
    nodeNameById.set(n.id, name);
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
            <span className="text-zinc-400">/</span>
            <span className="text-zinc-500">Entity</span>
          </nav>

          <h1 className="text-2xl font-semibold tracking-tight">
            {entity.canonicalName}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">{entity.type}</span>{" "}
            <span className="font-mono text-xs">{entity.id}</span>
          </p>
        </header>

        <section className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold">Identifiers</h2>
            <pre className="mt-2 overflow-auto text-xs text-zinc-700 dark:text-zinc-300">
              {JSON.stringify(entity.identifiers ?? {}, null, 2)}
            </pre>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold">Aliases</h2>
            <pre className="mt-2 overflow-auto text-xs text-zinc-700 dark:text-zinc-300">
              {JSON.stringify(entity.aliases ?? [], null, 2)}
            </pre>
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold">Assertions (active)</h2>
          <div className="space-y-3">
            {facts.map((f) => {
              const citation = citationByAssertionId.get(f.id) ?? null;
              return (
                <div
                  key={f.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{f.predicate}</span>{" "}
                      <span className="text-zinc-500">
                        → {f.objectEntityId ? nodeNameById.get(f.objectEntityId) ?? f.objectEntityId : "—"}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      conf={f.confidence.toFixed(2)}
                    </div>
                  </div>

                  {citation ? (
                    <div className="mt-3 rounded-xl border border-zinc-200/70 bg-zinc-50 p-3 text-xs leading-5 dark:border-zinc-800 dark:bg-black">
                      <div className="mb-1 text-[11px] text-zinc-500">
                        {citation.document.docType} • CIK {citation.document.cik} •{" "}
                        {citation.document.filingDate}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {citation.text.slice(0, 500)}
                        {citation.text.length > 500 ? "…" : ""}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {facts.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                No assertions yet for this entity. Run extraction on a document that mentions it.
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-12 space-y-3">
          <h2 className="text-lg font-semibold">Graph neighborhood</h2>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-xs text-zinc-500">
              nodes={neighborhood.nodes.length} edges={neighborhood.edges.length}
            </div>
            <div className="mt-3 space-y-2">
              {neighborhood.edges.slice(0, 60).map((e, idx) => (
                <div key={`${e.type}:${idx}`} className="font-mono text-xs">
                  <Link className="underline" href={`/entities/${e.from}`}>
                    {nodeNameById.get(e.from) ?? e.from}
                  </Link>{" "}
                  -[{e.type}]-&gt;{" "}
                  <Link className="underline" href={`/entities/${e.to}`}>
                    {nodeNameById.get(e.to) ?? e.to}
                  </Link>
                </div>
              ))}
              {neighborhood.edges.length === 0 ? (
                <div className="text-sm text-zinc-500">
                  No edges found. Try running extraction or increasing traversal depth.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}


