import { interpretRequest } from "@/lib/jev/interpretRequest";
import { FLOOR_COUNT } from "@/lib/hospital";

const isFloor = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < FLOOR_COUNT;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { from, to, note } = body ?? {};
  if (!isFloor(from) || !isFloor(to) || typeof note !== "string" || note.length > 500) {
    return Response.json({ error: "expected { from, to, note }" }, { status: 400 });
  }
  try {
    return Response.json(await interpretRequest({ from, to, note }));
  } catch (err) {
    console.error("interpretRequest failed", err);
    return Response.json({ error: "interpreter unavailable" }, { status: 502 });
  }
}
