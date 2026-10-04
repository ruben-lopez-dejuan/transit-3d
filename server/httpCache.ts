import type { RequestHandler } from 'express';

export const CACHE_CONTROL = {
  live: 'no-store',
  manifest: 'public, max-age=300, stale-while-revalidate=3600',
  catalog: 'public, max-age=300, stale-while-revalidate=1800',
  preparing: 'no-cache',
  assets: 'public, max-age=31536000, immutable',
  shell: 'no-cache',
} as const;

export function cacheControl(value: string): RequestHandler {
  return (_request, response, next) => {
    response.setHeader('Cache-Control', value);
    next();
  };
}

export function networkCacheControl(operators: readonly { loading?: boolean; status: string }[]) {
  return operators.some((operator) => operator.loading || operator.status === 'unavailable')
    ? CACHE_CONTROL.preparing
    : CACHE_CONTROL.catalog;
}
