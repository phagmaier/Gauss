// Posts to the server. Returns the server's reason when it refuses, so the
// page can show it, and nothing when the request was accepted.

import { IntakeStarted } from "../shared/events.ts";

type Answer = { ok: true; data: unknown } | { ok: false; error: string };

async function request(path: string, body?: unknown): Promise<Answer> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, error: "The server could not be reached." };
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { ok: true, data };
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return { ok: false, error: data.error };
  }
  return { ok: false, error: `The server answered ${response.status}.` };
}

export async function post(
  path: string,
  body?: unknown,
): Promise<string | undefined> {
  const answer = await request(path, body);
  return answer.ok ? undefined : answer.error;
}

/** Starts a new course's intake: its id, or the server's reason for refusing. */
export async function startIntake(): Promise<
  { ok: true; intakeId: string } | { ok: false; error: string }
> {
  const answer = await request("/api/intakes");
  if (!answer.ok) return answer;
  const parsed = IntakeStarted.safeParse(answer.data);
  return parsed.success
    ? { ok: true, intakeId: parsed.data.intakeId }
    : { ok: false, error: "The server's answer was not understood." };
}
