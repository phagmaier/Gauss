// Posts to the server. Returns the server's reason when it refuses, so the
// page can show it, and nothing when the request was accepted.

export async function post(
  path: string,
  body?: unknown,
): Promise<string | undefined> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return "The server could not be reached.";
  }
  if (response.ok) return undefined;
  const data: unknown = await response.json().catch(() => undefined);
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return data.error;
  }
  return `The server answered ${response.status}.`;
}
