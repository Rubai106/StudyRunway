"use client";

import { asArray, asString, isRecord } from "./shared";

interface Source {
  title: string;
  uri: string;
  domain: string;
}

interface SupportedClaim {
  text: string;
  sources: Source[];
}

function readSources(value: unknown): Source[] {
  return asArray<unknown>(value).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const uri = asString(raw["uri"]);
    if (!uri.startsWith("https://")) return [];
    return [{ title: asString(raw["title"], "Official source"), uri, domain: asString(raw["domain"]) }];
  });
}

function checkedDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function PolicyResearch({ data }: { data: Record<string, unknown> }) {
  const answer = asString(data["answer"]);
  const note = asString(data["note"]);
  const checkedAt = asString(data["checkedAt"]);
  const sources = readSources(data["sources"]);
  const claims: SupportedClaim[] = asArray<unknown>(data["supportedClaims"]).flatMap((raw) => {
    if (!isRecord(raw) || !asString(raw["text"])) return [];
    return [{ text: asString(raw["text"]), sources: readSources(raw["sources"]) }];
  });
  const searchHtml = asString(data["searchEntryPointHtml"]);

  return (
    <div>
      {answer ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--sr-ink)]">{answer}</p>
      ) : (
        <p className="text-sm font-medium text-[var(--sr-ink)]">No verified policy answer is available for this request.</p>
      )}
      {note && <p className="mt-2 text-xs leading-relaxed text-[var(--sr-ink)]/65">{note}</p>}
      {checkedAt && <p className="mt-2 text-[11px] text-[var(--sr-ink)]/50">Sources checked: {checkedDate(checkedAt)}</p>}

      {claims.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--sr-ink)]/60">Claims and supporting sources</h4>
          {claims.map((claim, index) => (
            <div key={`${claim.text}-${index}`} className="rounded-xl border border-[var(--sr-line)] bg-white/50 px-3 py-2.5">
              <p className="text-sm leading-relaxed text-[var(--sr-ink)]">{claim.text}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {claim.sources.map((source) => <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className="text-xs font-medium text-[var(--sr-pine)] underline underline-offset-2">{source.title}</a>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--sr-ink)]/60">Official source pages</h4>
          <ul className="mt-2 space-y-1.5">
            {sources.map((source) => (
              <li key={source.uri} className="text-sm">
                <a href={source.uri} target="_blank" rel="noreferrer" className="font-medium text-[var(--sr-pine)] underline underline-offset-2">{source.title}</a>
                {source.domain && <span className="ml-2 text-xs text-[var(--sr-ink)]/50">{source.domain}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {searchHtml && (
        <div className="mt-4" aria-label="Google Search suggestions">
          <iframe
            title="Google Search suggestions"
            srcDoc={searchHtml}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            referrerPolicy="no-referrer"
            className="h-[58px] w-full border-0"
          />
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--sr-ink)]/50">Policy pages can change and may apply differently by intake, visa status, and student category. Confirm important deadlines with the linked university or authority.</p>
    </div>
  );
}
