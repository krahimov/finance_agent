"use client";

import { useActionState } from "react";

import type { EdgarIngestResult } from "@/lib/edgar/ingest";
import type { ExtractionRunResult } from "@/lib/extraction/run";

import { runEdgarIngestionAction, runExtractionAction, type ActionState } from "./actions";

type JsonViewProps = { value: unknown };

function JsonView({ value }: JsonViewProps) {
  return (
    <pre className="overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 dark:border-zinc-800 dark:bg-zinc-950">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function IngestionForm() {
  const [ingestState, ingestAction, ingestPending] = useActionState<
    ActionState<EdgarIngestResult> | null,
    FormData
  >(runEdgarIngestionAction, null);

  const [extractState, extractAction, extractPending] = useActionState<
    ActionState<ExtractionRunResult> | null,
    FormData
  >(runExtractionAction, null);

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">EDGAR ingestion</h2>
        <form action={ingestAction} className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 sm:col-span-1">
            <div className="text-xs font-medium text-zinc-500">CIK</div>
            <input
              name="cik"
              placeholder="0000320193"
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            />
          </label>
          <label className="space-y-1 sm:col-span-1">
            <div className="text-xs font-medium text-zinc-500">Max filings</div>
            <input
              name="maxFilings"
              defaultValue={1}
              type="number"
              min={1}
              max={10}
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            />
          </label>
          <label className="space-y-1 sm:col-span-1">
            <div className="text-xs font-medium text-zinc-500">
              Max chunks per filing
            </div>
            <input
              name="maxChunksPerFiling"
              defaultValue={40}
              type="number"
              min={1}
              max={500}
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            />
          </label>

          <button
            type="submit"
            disabled={ingestPending}
            className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 sm:col-span-3"
          >
            {ingestPending ? "Ingesting…" : "Run ingestion"}
          </button>
        </form>

        {ingestState ? (
          ingestState.ok ? (
            <JsonView value={ingestState.data} />
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {ingestState.error}
            </div>
          )
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Extraction + graph projection</h2>
        <form action={extractAction} className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 sm:col-span-2">
            <div className="text-xs font-medium text-zinc-500">Document ID</div>
            <input
              name="documentId"
              placeholder="UUID from ingestion results"
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            />
          </label>
          <label className="space-y-1 sm:col-span-1">
            <div className="text-xs font-medium text-zinc-500">Max chunks</div>
            <input
              name="maxChunks"
              defaultValue={20}
              type="number"
              min={1}
              max={500}
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            />
          </label>

          <button
            type="submit"
            disabled={extractPending}
            className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 sm:col-span-3"
          >
            {extractPending ? "Extracting…" : "Run extraction"}
          </button>
        </form>

        {extractState ? (
          extractState.ok ? (
            <JsonView value={extractState.data} />
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {extractState.error}
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}


