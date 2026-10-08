/** Parse write responses before reporting a successful admin mutation. */
export async function requireAdminSuccess(
  response: Response,
  failure = `HTTP ${response.status}`,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  const data = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  if (!response.ok || !data || data.success !== true) {
    const message = [data?.error, data?.message].find((value) => typeof value === 'string' && value);
    throw new Error(typeof message === 'string' ? message : failure);
  }
  return data;
}
