import { z } from "zod";

/**
 * Wire schema for `{ mjml, reply }` JSON-mode responses. Both fields must be
 * non-empty strings. The MJML is later re-validated against
 * `parser.parseMjml(...)` before persistence — this schema only enforces shape.
 */
export const llmResponseSchema = z.object({
  mjml: z.string().min(1),
  reply: z.string().min(1),
});

export type LLMResponse = z.infer<typeof llmResponseSchema>;
