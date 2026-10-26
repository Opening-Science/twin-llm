import { readDocImage } from "@/features/docs/docs-pages";

/** Serves `docs/images/<name>` for the docs pages; png, jpg and svg only. */
export const GET = async (
  _request: Request,
  { params }: Readonly<{ params: Promise<{ name: string }> }>,
) => {
  const image = await readDocImage((await params).name);
  if (image === null) return new Response(null, { status: 404 });
  return new Response(image.body, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
};
