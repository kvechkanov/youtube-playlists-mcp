/** Parse a JSON response body; a non-JSON body (a proxy's HTML error page, say) becomes an error naming the status. */
export async function readJsonBody(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${what} returned HTTP ${res.status} with a non-JSON body: ${snippet}`);
  }
}
