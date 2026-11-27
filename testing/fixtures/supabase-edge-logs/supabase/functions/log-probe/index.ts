export {};

// Supabase provides Deno at runtime. Scope its type to this fixture.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

Deno.serve(async (request) => {
  if (request.method === "GET") return new Response("ready");
  if (request.method !== "POST") return new Response(null, { status: 405 });

  const marker = await request.text();
  if (!/^[0-9a-f-]{36}$/.test(marker))
    return new Response(null, { status: 400 });

  // Space the events so a small provider page can advance past its oldest
  // millisecond. The two identical messages should still have different IDs.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  console.info(marker + "/info");
  await pause();
  console.warn(marker + "/warn");
  await pause();
  console.error(marker + "/error");
  await pause();
  console.info(marker + "/duplicate");
  await pause();
  console.info(marker + "/duplicate");
  return Response.json({ marker, finishedAt: Date.now() });
});
