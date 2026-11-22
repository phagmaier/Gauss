import { expect, test } from "vitest";
import { webSite } from "./events.ts";

test("a search result opens only at a web address, and is named by its site without www", () => {
  expect(webSite("https://www.plato.stanford.edu/entries/adorno/")).toEqual({
    site: "plato.stanford.edu",
    opens: true,
  });
  expect(webSite("http://example.org/a?b=c")).toEqual({
    site: "example.org",
    opens: true,
  });
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "not an address",
  ]) {
    expect(webSite(url)).toEqual({ site: url, opens: false });
  }
});
