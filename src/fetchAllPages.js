export const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllPages(queryPage, pageSize = DEFAULT_PAGE_SIZE) {
  if (typeof queryPage !== 'function') throw new TypeError('queryPage must be a function');
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer');

  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message || 'Page query failed');
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
