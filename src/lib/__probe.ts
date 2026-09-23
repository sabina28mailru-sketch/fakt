import { GoogleGenAI, ApiError, type Interactions } from "@google/genai";

type StreamParams = Omit<Interactions.CreateModelInteractionParamsStreaming, "stream">;

export async function probe(client: GoogleGenAI, params: StreamParams) {
  const stream = await client.interactions.create({ ...params, stream: true });
  for await (const ev of stream) {
    if (ev.event_type === "step.delta") {
      const d = ev.delta;
      if (d.type === "text") console.log(d.text);
      else if (d.type === "google_search_call") console.log(d.arguments.queries);
      else if (d.type === "url_context_call") console.log(d.arguments.urls);
      else if (d.type === "url_context_result") console.log(d.result.map((r) => r.url), d.is_error);
      else if (d.type === "google_search_result") console.log(d.is_error);
      else if (d.type === "text_annotation_delta") {
        for (const a of d.annotations ?? []) if (a.type === "url_citation") console.log(a.url, a.title);
      }
    } else if (ev.event_type === "interaction.completed") {
      const u = ev.interaction.usage;
      console.log(u?.total_input_tokens, u?.total_output_tokens, u?.grounding_tool_count);
    } else if (ev.event_type === "error") {
      console.log(ev.error?.message, ev.error?.code);
    }
  }
  const e: unknown = null;
  if (e instanceof ApiError) console.log(e.status, e.message);
}
