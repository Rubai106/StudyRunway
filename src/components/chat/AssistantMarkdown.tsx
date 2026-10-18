import React, { type ReactNode } from "react";

function safeHref(value: string): string | null {
  try {
    const url = new URL(value, "https://studyrunway.invalid");
    if (!/^(https?:)$/i.test(url.protocol) || url.origin === "https://studyrunway.invalid") return null;
    return url.href;
  } catch {
    return null;
  }
}

function inlineContent(text: string, keyPrefix: string): ReactNode[] {
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g;
  return text.split(tokenPattern).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\*\*[^*]+\*\*$/.test(token) || /^__[^_]+__$/.test(token)) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(token)) {
      return <code key={key} className="rounded bg-[var(--sr-mist)] px-1 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>;
    }
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="underline decoration-[var(--sr-pine)] underline-offset-2">
          {link[1]}
        </a>
      ) : <span key={key}>{token}</span>;
    }
    return <span key={key}>{token}</span>;
  });
}

export default function AssistantMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; value: string }[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="mb-3 last:mb-0">
        {inlineContent(paragraph.join(" "), `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    const ordered = list[0].ordered;
    const List = ordered ? "ol" : "ul";
    blocks.push(
      <List key={`list-${blocks.length}`} className={`${ordered ? "list-decimal" : "list-disc"} mb-3 space-y-1 pl-5 last:mb-0`}>
        {list.map((item, index) => <li key={`item-${index}`}>{inlineContent(item.value, `item-${index}`)}</li>)}
      </List>,
    );
    list = [];
  };

  for (const line of lines) {
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list.length > 0 && list[0].ordered !== isOrdered) flushList();
      list.push({ ordered: isOrdered, value: (ordered ?? unordered)![1] });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return <div className="whitespace-normal">{blocks}</div>;
}
