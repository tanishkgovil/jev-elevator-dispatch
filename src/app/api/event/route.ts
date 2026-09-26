import { interpretEvent } from "@/lib/jev/interpretEvent";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = body?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 300) {
    return Response.json({ error: "expected { text }" }, { status: 400 });
  }
  try {
    return Response.json(await interpretEvent(text.trim()));
  } catch (err) {
    console.error("interpretEvent failed", err);
    return Response.json({ error: "interpreter unavailable" }, { status: 502 });
  }
}
