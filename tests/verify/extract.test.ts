import { describe, expect, test } from "vitest";
import { extractHtml, extractPdf } from "../../src/verify/extract";

describe("extractHtml", () => {
  test("returns the visible text of a simple page", () => {
    expect(extractHtml("<p>Open year around</p>")).toBe("Open year around");
  });

  test("drops script and style contents entirely", () => {
    const html = "<style>p{color:red}</style><p>Daily: 3</p><script>var x='Daily: 9'</script>";
    const text = extractHtml(html);
    expect(text).toContain("Daily: 3");
    expect(text).not.toContain("color");
    expect(text).not.toContain("Daily: 9");
  });

  test("decodes HTML entities", () => {
    expect(extractHtml("<p>bag &amp; possession &#8212; 5&nbsp;fish</p>"))
      .toBe("bag & possession — 5 fish");
  });

  test("keeps block elements from running their text together", () => {
    expect(extractHtml("<td>Rainbow Trout</td><td>1500</td>")).toBe("Rainbow Trout 1500");
  });

  test("strips comments", () => {
    expect(extractHtml("<p>open<!-- closed --></p>")).toBe("open");
  });
});

describe("extractPdf", () => {
  test("invokes pdftotext with -layout and returns its stdout", async () => {
    const calls: string[][] = [];
    const fakeRun = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return "Daily: 3 game fish";
    };
    const text = await extractPdf(new Uint8Array([1, 2, 3]), fakeRun);
    expect(text).toBe("Daily: 3 game fish");
    expect(calls[0][0]).toBe("pdftotext");
    expect(calls[0]).toContain("-layout");
  });
});
