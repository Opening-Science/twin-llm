/**
 * Readable names for our own fine-tunes. A model id `twinllm-<base>-<tag>`
 * reads "TwinLLM <size> (<tag>)": `twinllm-qwen3-4b-pilot1` is
 * "TwinLLM 4B (pilot 1)". The size is the base's last part when it looks like
 * one (`4b`, `0.6b`); otherwise the whole base is shown. A trailing number in
 * the tag is set off with a space, and an Ollama tag other than `latest`
 * joins the tag after a comma. Any other id gets null and keeps its own name.
 *
 * The raw id stays visible under the name in the picker and the answer
 * column, so a name never hides which model ran. A served id with a path
 * (`org/twinllm-…`) is read by its last part.
 */

const PREFIX = "twinllm-";
const SIZE = /^\d+(?:\.\d+)?[bm]$/i;

const readableTag = (tag: string): string =>
  tag
    .split(/[-_]/)
    .filter((part) => part !== "")
    .map((part) => part.replace(/^([a-z]+)(\d+)$/i, "$1 $2"))
    .join(" ");

export const friendlyModelName = (modelId: string): string | null => {
  const bare = modelId.split("/").at(-1) ?? "";
  const [name = "", ollamaTag] = bare.split(":", 2);
  if (!name.startsWith(PREFIX)) return null;
  const parts = name.slice(PREFIX.length).split("-");
  if (parts.length < 2 || parts.some((part) => part === "")) return null;
  const tag = parts.at(-1) ?? "";
  const base = parts.slice(0, -1);
  const last = base.at(-1) ?? "";
  const label = SIZE.test(last) ? last.toUpperCase() : base.join("-");
  const extras = [
    readableTag(tag),
    ...(ollamaTag === undefined || ollamaTag === "latest" ? [] : [ollamaTag]),
  ];
  return `TwinLLM ${label} (${extras.join(", ")})`;
};

/** The catalog name for an id: the friendly one when there is one, else the id. */
export const displayModelName = (modelId: string): string =>
  friendlyModelName(modelId) ?? modelId;
