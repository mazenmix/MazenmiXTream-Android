// This deployment replaces every former page, asset and IPTV API route.
const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mx1</title>
<style>html,body{margin:0;min-height:100%;background:#000;color:#fff}body{min-height:100vh;min-height:100dvh;display:grid;place-items:center;font:600 clamp(36px,10vw,80px)/1 system-ui,sans-serif}</style>
</head>
<body>mx1</body>
</html>
`;

export default {
  async fetch(request) {
    return new Response(request.method === "HEAD" ? null : HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-MX-Release": "mx1-placeholder"
      }
    });
  }
};
