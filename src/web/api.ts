// Talks to the server. A refusal comes back as the server's reason, so the
// page can show it; an answer is checked against its schema in src/shared/.

import type { z } from "zod";

export type Answer<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

async function request<T>(
  path: string,
  schema: z.ZodType<T> | undefined,
  init: RequestInit,
): Promise<Answer<T | undefined>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: "The server could not be reached." };
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `The server answered ${response.status}.`;
    return { ok: false, status: response.status, error };
  }
  if (schema === undefined) return { ok: true, data: undefined };
  const parsed = schema.safeParse(data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : {
        ok: false,
        status: response.status,
        error: "The server's answer was not understood.",
      };
}

function postInit(body: unknown): RequestInit {
  return body === undefined
    ? { method: "POST" }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
}

export function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<Answer<T>> {
  return request(path, schema, {}) as Promise<Answer<T>>;
}

/** Posts and reads the answer. */
export function postFor<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<Answer<T>> {
  return request(path, schema, postInit(body)) as Promise<Answer<T>>;
}

/** Posts; the server's reason when it refuses, nothing when it accepts. */
export async function post(
  path: string,
  body?: unknown,
): Promise<string | undefined> {
  const answer = await request(path, undefined, postInit(body));
  return answer.ok ? undefined : answer.error;
}

/** Posts; the server's reason and the status when it refuses (0: not reached). */
export function postStatus(
  path: string,
  body?: unknown,
): Promise<Answer<undefined>> {
  return request(path, undefined, postInit(body));
}
