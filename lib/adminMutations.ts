/** Parse write responses before reporting a successful admin mutation. */
export async function requireAdminSuccess(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data || data.success !== true) {
    throw new Error(String(data?.error || data?.message || `HTTP ${response.status}`));
  }
  return data;
}
