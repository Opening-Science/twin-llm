import { NextResponse } from "next/server";

/**
 * Serves a pinned public GLB from a closed list (atlases, demo bodies), as a
 * factory so tests pass fakes.
 *
 * These are public licensed files, not personal data: no auth, no audit, and
 * long-lived public caching when the URL carries the pinned version
 * (`?v=<sha16>`). A missing or partial file is an honest JSON 404.
 */
type PinnedRouteContext = { params: Promise<unknown> };

export type PinnedGlbSpec<Id extends string> = Readonly<{
  /** The dynamic segment's name, e.g. "atlasId". */
  param: string;
  isId: (value: unknown) => value is Id;
  sha256: (id: Id) => string;
  version: (id: Id) => string;
  open: (id: Id) => Promise<Uint8Array<ArrayBuffer> | null>;
  notInstalled: string;
}>;

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

/** RFC 9110 If-None-Match: a list, weak validators compare equal, `*` matches. */
export const matchesEtag = (header: string | null, etag: string): boolean =>
  header !== null &&
  header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .some((value) => value === etag || value === "*");

/** One pinned GLB: its SHA-256, the `?v=` that makes it immutable (null: never), its bytes. */
export type PinnedGlb = Readonly<{
  sha256: string;
  version: string | null;
  open: () => Promise<Uint8Array<ArrayBuffer> | null>;
  notInstalled: string;
}>;

/** The ETag is the pinned SHA-256; caching and the 404 follow the rules above. */
export const servePinnedGlb = async (
  request: Request,
  pin: PinnedGlb,
): Promise<Response> => {
  const etag = `"${pin.sha256}"`;
  const version = new URL(request.url).searchParams.get("v");
  const cacheControl =
    pin.version !== null && version === pin.version ? IMMUTABLE : REVALIDATE;

  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const bytes = await pin.open();
  if (!bytes) {
    return NextResponse.json(
      { error: pin.notInstalled, installed: false },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "model/gltf-binary",
      "Content-Length": String(bytes.byteLength),
      ETag: etag,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const createPinnedGlbHandler = <Id extends string>(spec: PinnedGlbSpec<Id>) => {
  return async (request: Request, context: PinnedRouteContext) => {
    const params = (await context.params) as Record<string, unknown>;
    const id = params[spec.param];
    if (!spec.isId(id)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return servePinnedGlb(request, {
      sha256: spec.sha256(id),
      version: spec.version(id),
      open: () => spec.open(id),
      notInstalled: spec.notInstalled,
    });
  };
};
