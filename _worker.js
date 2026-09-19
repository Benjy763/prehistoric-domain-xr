/**
 * Cloudflare Pages custom Worker (canonical source — copied into dist/
 * by deploy-pages.js before each deploy, since dist/ is rebuilt from
 * scratch every time).
 *
 * Serves /assets/* directly from the R2 bucket (same origin as the page,
 * so no CORS is needed — Pages' _redirects can't proxy cross-origin
 * requests, and a redirect breaks CORS preflight since browsers don't
 * follow redirects for OPTIONS preflight requests). Everything else falls
 * through to the normal static Pages asset serving.
 *
 * Edge-cached via the Workers Cache API: the first request for a given
 * asset fetches it from R2, every subsequent request (from any visitor,
 * anywhere) is served from Cloudflare's edge cache without hitting R2
 * again. The build's cache-busting "?lastmod=" query param (see
 * webpack.prod.config.js) doubles as the cache key version, so a new
 * deploy naturally busts stale cached entries.
 *
 * The cache key only keeps that "lastmod" param and drops everything else
 * from the query string — otherwise anyone could append a random query
 * param (?x=random) to force a cache miss on every request, turning every
 * hit into a real R2 read (the only thing that can actually cost money
 * here, since R2 has no egress fee).
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/assets/')) {
      const cacheKeyUrl = new URL(request.url);
      const lastmod = cacheKeyUrl.searchParams.get('lastmod');
      cacheKeyUrl.search = lastmod ? `?lastmod=${lastmod}` : '';
      const cacheKey = new Request(cacheKeyUrl.toString(), request);

      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const key = url.pathname.slice(1); // strip leading "/" -> "assets/..."
      const object = await env.ASSETS_BUCKET.get(key);

      if (object === null) {
        return new Response('Not found', { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'public, max-age=31536000, immutable');

      const response = new Response(object.body, { headers });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    return env.ASSETS.fetch(request);
  }
};
