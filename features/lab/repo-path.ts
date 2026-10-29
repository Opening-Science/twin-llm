import { isAbsolute, relative, resolve } from "node:path";

/**
 * A configured path as an absolute path inside the repository, or null when
 * it points outside it. The Lab reads files only within the repository, so a
 * setting such as `../../elsewhere` or `/etc/x` is refused, not followed.
 * Pure (path arithmetic only; symbolic links are not resolved).
 */
export const insideRepo = (root: string, path: string): string | null => {
  const absolute = resolve(/* turbopackIgnore: true */ root, path);
  const inside = relative(root, absolute);
  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)
    ? absolute
    : null;
};
