export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Drain a range-paginated PostgREST query into one array.
 *
 * The JSDoc is load-bearing: the Supabase Edge Functions type-check this module
 * under Deno with `strict`, and without it the callback parameters land as
 * implicit `any`.
 *
 * @template T
 * A PostgREST builder is a thenable rather than a real Promise, so the callback
 * is typed as PromiseLike — requiring Promise here rejects every real call site.
 *
 * @param {(from: number, to: number) => PromiseLike<{ data: T[] | null, error: { message?: string } | null }>} queryPage
 * @param {number} [pageSize]
 * @returns {Promise<T[]>}
 */
export async function fetchAllPages(queryPage, pageSize = DEFAULT_PAGE_SIZE) {
  if (typeof queryPage !== 'function') {
    throw new TypeError('queryPage must be a function');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('pageSize must be a positive integer');
  }

  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message || 'Page query failed');
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
