import { convertToModelMessages, stepCountIs, streamText } from "ai";
import type { UIMessage } from "ai";

import { getChatModel } from "@/lib/ai/model";
import { SYSTEM_PROMPT } from "@/lib/ai/system";
import { tools } from "@/lib/ai/tools";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      "Missing OPENAI_API_KEY. Set it in your environment to use /api/chat.",
      { status: 500 },
    );
  }

  const body = (await req.json()) as { messages?: UIMessage[] };
  if (!Array.isArray(body.messages)) {
    return new Response("Invalid payload: expected { messages: [...] }", {
      status: 400,
    });
  }

  // `@ai-sdk/react` uses UI messages. Convert to model messages before calling `streamText`.
  const modelMessages = await convertToModelMessages(
    body.messages.map((m) => ({
      role: m.role,
      parts: m.parts,
      metadata: m.metadata,
    })),
    { tools },
  );

  const result = await streamText({
    model: getChatModel(),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    // Default stop condition is stepCountIs(1), which would stop right after the first tool call.
    // Allow multi-step tool use (e.g. vectorSearch -> getCitations -> summary).
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: body.messages,
  });
}
