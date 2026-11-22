import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type DataRoot, openDataRoot } from "./data-root.ts";

// A 1 × 1 grayscale PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-page-image-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function pdfSource() {
  const root = openDataRoot({ path: dir });
  const { id: course } = await root.createCourse({ title: "Calculus" });
  const source = "notes";
  const folder = join(dir, "courses", course, "sources", source);
  const original = join(folder, "original.pdf");
  await mkdir(folder, { recursive: true });
  await writeFile(original, "not used by the test renderer");
  await writeFile(
    join(folder, "outline.json"),
    JSON.stringify({
      id: source,
      title: "Notes",
      file: "original.pdf",
      name: "notes.pdf",
      format: "pdf",
      sha256: "a".repeat(64),
      converter: 5,
      limit: 20_000,
      pages: { count: 1, blank: [] },
      entries: [
        {
          id: "s1",
          title: "Notes",
          size: 1,
          place: { pages: { first: 1, last: 1 } },
        },
      ],
    }),
  );
  return {
    original,
    pages: join(folder, "pages"),
    request: (render: Parameters<DataRoot["pageImage"]>[3]) =>
      root.pageImage(course, source, 1, render),
  };
}

test("overlapping requests render once in a private folder and share the kept PNG", async () => {
  const { original, pages, request } = await pdfSource();
  const render = vi.fn(async (input: string, png: string) => {
    expect(input).toBe(original);
    expect(dirname(dirname(png))).toBe(pages);
    await writeFile(png, PNG);
  });

  expect(await Promise.all([request(render), request(render)])).toEqual([
    PNG,
    PNG,
  ]);
  expect(render).toHaveBeenCalledTimes(1);
  expect(await readdir(pages)).toEqual(["1.png"]);
  expect(await readFile(join(pages, "1.png"))).toEqual(PNG);
});

test("a render that throws leaves neither its partial output nor its other scratch files", async () => {
  const { pages, request } = await pdfSource();
  const failure = new Error("render failed");
  await expect(
    request(async (_original, png) => {
      await writeFile(png, PNG.subarray(0, 10));
      await writeFile(join(dirname(png), "other-partial-file"), "partial");
      throw failure;
    }),
  ).rejects.toThrow(failure);
  expect(await readdir(pages)).toEqual([]);
});

const invalidOutputs = [
  {
    name: "a truncated PNG",
    reason: /not a bounded PNG/,
    put: (file: string) => writeFile(file, PNG.subarray(0, -1)),
  },
  {
    name: "a symlink to an otherwise valid PNG",
    reason: /ELOOP/,
    async put(file: string) {
      const fixture = join(dir, "fixture.png");
      await writeFile(fixture, PNG);
      await symlink(fixture, file);
    },
  },
  {
    name: "a directory instead of a file",
    reason: /not a regular file/,
    async put(file: string) {
      await mkdir(file);
    },
  },
  {
    name: "an oversized file",
    reason: /exceeds the 16 MiB page image limit/,
    async put(file: string) {
      const handle = await open(file, "wx");
      try {
        await handle.writeFile(PNG);
        await handle.truncate(16 * 1024 * 1024 + 1);
      } finally {
        await handle.close();
      }
    },
  },
];

test.each(invalidOutputs)(
  "does not publish $name even when rendering reports success",
  async ({ put, reason }) => {
    const { pages, request } = await pdfSource();
    await expect(request((_original, png) => put(png))).rejects.toThrow(reason);
    expect(await readdir(pages)).toEqual([]);
  },
);

test.each(invalidOutputs)(
  "rejects $name on a cache hit without rendering over it",
  async ({ put, reason }) => {
    const { pages, request } = await pdfSource();
    await mkdir(pages);
    await put(join(pages, "1.png"));
    const render = vi.fn((_original: string, png: string) =>
      writeFile(png, PNG),
    );

    await expect(request(render)).rejects.toThrow(reason);
    expect(render).not.toHaveBeenCalled();
    expect(await readdir(pages)).toEqual(["1.png"]);
  },
);
