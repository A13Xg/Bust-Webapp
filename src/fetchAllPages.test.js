import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './fetchAllPages.js';

describe('fetchAllPages', () => {
  it('retrieves complete history beyond the 1,000-row boundary', async () => {
    const source = Array.from({ length: 2505 }, (_, id) => ({ id }));
    const queryPage = vi.fn(async (from, to) => ({ data: source.slice(from, to + 1), error: null }));

    const rows = await fetchAllPages(queryPage, 1000);

    expect(rows).toHaveLength(2505);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows.at(-1)).toEqual({ id: 2504 });
    expect(queryPage).toHaveBeenCalledTimes(3);
    expect(queryPage).toHaveBeenNthCalledWith(1, 0, 999);
    expect(queryPage).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(queryPage).toHaveBeenNthCalledWith(3, 2000, 2999);
  });

  it('propagates page errors instead of returning partial history', async () => {
    const queryPage = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 2 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } });

    await expect(fetchAllPages(queryPage, 2)).rejects.toThrow('database unavailable');
  });

  it('rejects invalid page sizes', async () => {
    await expect(fetchAllPages(async () => ({ data: [], error: null }), 0)).rejects.toThrow('positive integer');
  });
});
