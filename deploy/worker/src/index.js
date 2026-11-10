/**
 * Fixed public address for Learning Hub: forwards every request to the current Cloudflare
 * Quick Tunnel (ORIGIN, set by deploy/cloudflared/start-public.ps1) and passes the answer back
 * unchanged, so cookies, redirects and uploads behave as if the app were served here.
 */
export default {
  async fetch(request, env) {
    if (!env.ORIGIN) return new Response('Learning Hub is not connected yet.', { status: 503 })
    const incoming = new URL(request.url)
    const target = new URL(incoming.pathname + incoming.search, env.ORIGIN)

    const headers = new Headers(request.headers)
    headers.delete('host')
    const client = request.headers.get('cf-connecting-ip')
    if (client) headers.set('x-forwarded-for', client)
    headers.set('x-forwarded-proto', 'https')
    headers.set('x-forwarded-host', incoming.host)

    try {
      return await fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        // OAuth and sign-in redirects must reach the browser, not be followed here.
        redirect: 'manual',
      })
    } catch {
      return new Response('Learning Hub is offline (the computer or its tunnel is not running).', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  },
}
