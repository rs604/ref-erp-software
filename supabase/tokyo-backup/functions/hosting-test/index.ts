import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  const html = `<!DOCTYPE html>
<html><body><h1>Test OK</h1><p>If you can see this without any login or key, direct hosting works.</p></body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
