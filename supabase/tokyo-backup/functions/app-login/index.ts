import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  const html = await Deno.readTextFile(new URL("./page.html", import.meta.url));
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
