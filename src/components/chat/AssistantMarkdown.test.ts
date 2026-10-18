import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AssistantMarkdown from "./AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("renders bold text and ordered plans as semantic HTML", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMarkdown, { text: "**Plan**:\n\n1. Check funds\n2. Confirm the due date" }),
    );
    expect(html).toContain("<strong>Plan</strong>");
    expect(html).toContain("<ol");
    expect(html.indexOf("Check funds")).toBeLessThan(html.indexOf("Confirm the due date"));
    expect(html).not.toContain("**Plan**");
  });

  it("keeps uploaded HTML and unsafe links inert", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMarkdown, { text: '<script>alert("x")</script> [run](javascript:alert(1)) [source](https://example.gov/page)' }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.gov/page"');
  });
});
