// Same-origin proxy from the /trade pages to the FastAPI agents service.
//
// The agents' location is one server-side setting, AGENTS_API_URL, read on every
// request (no localhost default, nothing baked into the browser bundle). The
// browser only ever calls /api/agents/..., so there is no CORS setup either.
//
// Not an open proxy: requests can only reach paths under AGENTS_API_URL, path
// segments are re-encoded (no "..", no absolute URLs), and only the headers the
// agents use are forwarded.

const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "x-near-account"] as const;
// The strategy planner can take up to ~90 s (LLM), so allow a little more.
const TIMEOUT_MS = 100_000;

function fail(status: number, detail: string) {
  return Response.json({ detail }, { status });
}

async function forward(req: Request, ctx: RouteContext<"/api/agents/[...path]">) {
  const base = process.env.AGENTS_API_URL;
  if (!base) return fail(503, "AGENTS_API_URL is not set on the web server.");

  const { path } = await ctx.params;
  if (path.some((seg) => seg === "" || seg === "." || seg === "..")) return fail(400, "Invalid path.");

  let target: URL;
  try {
    target = new URL(base.replace(/\/+$/, "") + "/" + path.map(encodeURIComponent).join("/"));
  } catch {
    return fail(503, "AGENTS_API_URL is not a valid URL.");
  }
  target.search = new URL(req.url).search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return fail(timedOut ? 504 : 502, timedOut ? "The agents service timed out." : "Can't reach the agents service.");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export const GET = forward;
export const POST = forward;
