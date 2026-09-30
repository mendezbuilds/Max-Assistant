import Groq from "groq-sdk";

// Groq's own model lineup has already shifted once under this project (the
// once-standard llama-3.3-70b-versatile is gone from /v1/models entirely as
// of this writing) — picked live against the real /v1/models list rather
// than assumed. Of what's actually available, gpt-oss-120b beat gpt-oss-20b
// on BOTH speed and quality in a real side-by-side call (662ms vs 1187ms,
// and correctly named the real agents from context) — a mixture-of-experts
// model, so its real per-token cost on Groq's hardware is well below its
// parameter count suggests. If this ever disappears from the lineup too,
// check /v1/models again rather than guessing a replacement.
const TEXT_MODEL = "openai/gpt-oss-120b";

let client: Groq | null = null;

/** Throws a clear, specific error rather than letting a missing-key call fail deep inside the SDK with a less obvious message. */
function getClient(): Groq {
  if (client) return client;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set — MAX's text replies need it (see .env).");
  }
  client = new Groq({ apiKey });
  return client;
}

/**
 * Plain 1-2 sentence reply, grounded in real current state (passed in by the
 * caller — this module has no DB access of its own) rather than the model's
 * own guesses. Kept deliberately simple: one text turn, no chat history, no
 * tool-calling — which agent (if any) got mentioned is decided separately by
 * the caller via plain substring matching against real agent names, which is
 * both simpler and more reliable for that specific decision than asking the
 * model to also emit structured output. Same grounding/system-prompt
 * behavior as the Gemini version this replaces — only the model changed.
 */
export async function generateMaxReply(userText: string, contextBlock: string): Promise<string> {
  const groq = getClient();
  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are MAX, the calm, professional AI orchestrator for a personal agent hub. " +
          "Reply in 1-2 short sentences, plain prose, no markdown. " +
          "Only state facts given to you in the CURRENT STATE block below — never invent agent " +
          "names, numbers, or events that aren't in it. If the state doesn't cover what's asked, " +
          "say so plainly instead of guessing.\n\nCURRENT STATE:\n" +
          contextBlock,
      },
      { role: "user", content: userText },
    ],
  });
  const text = response.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned an empty response");
  return text;
}
