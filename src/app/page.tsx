"use client";

import { useChat } from "@ai-sdk/react";
import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";
import Link from "next/link";
import { useMemo, useState } from "react";

type Part = UIMessagePart<UIDataTypes, UITools>;

function PartView({ part }: { part: Part }) {
  if (!part || typeof part !== "object") return null;

  if (part.type === "text") {
    return <div className="whitespace-pre-wrap leading-6">{part.text}</div>;
  }

  if (part.type === "reasoning") {
    return (
      <details className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/30">
        <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-zinc-500">
          Reasoning
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-700 dark:text-zinc-200">
          {part.text}
        </pre>
      </details>
    );
  }

  // Tool parts: type is `tool-${name}` or `dynamic-tool`
  if (
    typeof part.type === "string" &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool")
  ) {
    const toolName =
      part.type === "dynamic-tool"
        ? (part as Extract<Part, { type: "dynamic-tool" }>).toolName
        : part.type.startsWith("tool-")
          ? part.type.slice("tool-".length)
          : part.type;

    const toolPart = part as unknown as {
      state?: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    const title = `${toolName} (${toolPart.state ?? "unknown"})`;
    const payload = toolPart.state?.startsWith("output")
      ? toolPart.output
      : toolPart.input;
    const errorText = toolPart.errorText;

    return (
      <details className="rounded-xl border border-zinc-200/70 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-zinc-500">
          Tool: {title}
        </summary>
        {errorText ? (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {errorText}
          </div>
        ) : null}
        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs leading-5 text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100">
          {JSON.stringify(payload ?? {}, null, 2)}
        </pre>
      </details>
    );
  }

  // Fallback for other part types (sources, files, etc.)
  return (
    <details className="rounded-xl border border-zinc-200/70 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-zinc-500">
        Part: {String(part.type ?? "unknown")}
      </summary>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs leading-5 text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100">
        {JSON.stringify(part, null, 2)}
      </pre>
    </details>
  );
}

export default function Home() {
  const initialMessages = useMemo(
    () => [
      {
        id: "intro",
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: "Ask me something like: “Run a health check”, “Vector search tariffs in AAPL filings”, or “Find entities for NVIDIA”.",
          },
        ],
      },
    ],
    [],
  );

  const { messages, sendMessage, status, error } = useChat<UIMessage>({
    // Default transport targets /api/chat
    messages: initialMessages,
  });

  const [input, setInput] = useState("");
  const isLoading = status === "submitted" || status === "streaming";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto max-w-3xl px-6 py-10">
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
            Markets Knowledge Graph
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Module 1 scaffold: streaming chat + tool-calling (Vercel AI SDK)
          </p>
        </header>

        <section className="mt-8 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl border border-zinc-200/70 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {m.role}
              </div>
              <div className="mt-2 space-y-2">
                {Array.isArray(m.parts) && m.parts.length > 0 ? (
                  m.parts.map((p, idx) => (
                    <PartView key={`${m.id}:${idx}`} part={p as Part} />
                  ))
                ) : (
                  <span className="text-zinc-400">(no message parts)</span>
                )}
              </div>
            </div>
          ))}
        </section>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {String(error?.message ?? error)}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 flex gap-2">
          <input
            className="h-12 flex-1 rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-zinc-700"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a question…"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="h-12 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isLoading ? "Sending…" : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}
