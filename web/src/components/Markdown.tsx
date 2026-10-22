import { Fragment, type ReactNode } from "react";

/**
 * The small slice of Markdown Claude's answers use — paragraphs, headings,
 * lists, tables, bold, italic and code — rendered as React elements, never
 * as raw HTML. Tolerates half-written input while an answer streams in.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length)
      blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push(
        <h4
          key={blocks.length}
          className="mt-1 text-[14px] font-semibold text-fg"
        >
          {inline(heading[2]!)}
        </h4>,
      );
      continue;
    }
    if (
      trimmed.startsWith("|") &&
      /^\|?\s*:?-{2,}/.test(lines[i + 1]?.trim() ?? "")
    ) {
      flush();
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|"))
        rows.push(cells(lines[i++]!));
      i--;
      const numeric = head.map(
        (_, c) =>
          rows.length > 0 &&
          rows.every((r) => /^[−\-+$€£\d.,%()\s]*$/.test(r[c] ?? "")),
      );
      blocks.push(
        <div
          key={blocks.length}
          className="overflow-x-auto rounded-[10px] shadow-[0_0_0_1px_var(--line)]"
        >
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-2 text-fg-2">
              <tr>
                {head.map((h, c) => (
                  <th
                    key={c}
                    className={`px-3 py-1.5 font-medium ${numeric[c] ? "text-right" : "text-left"}`}
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line">
                  {head.map((_, c) => (
                    <td
                      key={c}
                      className={`px-3 py-1.5 ${numeric[c] ? "text-right num" : ""}`}
                    >
                      {inline(r[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const item = trimmed.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i]!.trim().match(/^([-*•]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push(m[2]!);
        i++;
      }
      i--;
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={blocks.length}
          className={`flex flex-col gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-fg-3`}
        >
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return (
    <div className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-fg">
      {blocks}
    </div>
  );
}

function inline(s: string): ReactNode {
  const parts = s.split(
    /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g,
  );
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
      return (
        <strong key={i} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
      return (
        <code
          key={i}
          className="rounded-[5px] bg-surface-2 px-1 py-px text-[12.5px]"
        >
          {p.slice(1, -1)}
        </code>
      );
    if (
      ((p.startsWith("*") && p.endsWith("*")) ||
        (p.startsWith("_") && p.endsWith("_"))) &&
      p.length > 2
    )
      return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
