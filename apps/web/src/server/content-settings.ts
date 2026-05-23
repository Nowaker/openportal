import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  ALL_CONTENT_TYPES,
  ALL_VISIBILITIES,
  getContentSettings,
  resetContentSettings,
  setContentRule,
  type ContentType,
  type Visibility,
} from "./lib/content-settings-state";
import { parseBody } from "./lib/validation";

const ruleSchema = z.object({
  contentType: z.enum(
    ALL_CONTENT_TYPES as unknown as [ContentType, ...ContentType[]],
  ),
  visibility: z.enum(
    ALL_VISIBILITIES as unknown as [Visibility, ...Visibility[]],
  ),
  maxBytes: z.number().int().positive().nullable(),
});

const resetSchema = z.object({ reset: z.literal(true) });

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getContentSettings();
  }
  if (method === "PUT") {
    const body = await parseBody(event, ruleSchema.or(resetSchema));
    if ("reset" in body) {
      return resetContentSettings();
    }
    setContentRule(body.contentType, {
      visibility: body.visibility,
      maxBytes: body.maxBytes,
    });
    return getContentSettings();
  }
  return new Response("Method not allowed", { status: 405 });
});
