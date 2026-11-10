import { z } from "zod";
import { MAX_ASSETS_PER_CHANGE } from "./site-assets";

/** What the change route accepts. Order matters: a z.union takes the first shape that fits and drops keys it does not list. */
export const ChangeBody = z.union([
  // The revision shape comes before the plain text one: a revision also has text, and the text shape would drop its "revise" key.
  z.object({ revise: z.number().int(), text: z.string().min(1).max(2000), assetIds: z.array(z.string().uuid()).max(MAX_ASSETS_PER_CHANGE).optional() }),
  z.object({ text: z.string().min(1).max(2000), assetIds: z.array(z.string().uuid()).max(MAX_ASSETS_PER_CHANGE).optional() }),
  z.object({ confirm: z.number().int() }),
  z.object({ cancel: z.number().int() }),
  z.object({ approve: z.number().int() }),
  z.object({ remove: z.number().int() }),
  z.object({ undo: z.number().int() }),
]);
