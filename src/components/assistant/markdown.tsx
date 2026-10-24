import { Fragment } from "react";
import { parseMarkdown, type Inline, type Line } from "@/lib/markdown";

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>;
      case "bold":
        return (
          <strong key={i} className="font-semibold text-fg">
            <InlineNodes nodes={node.children} />
          </strong>
        );
      case "italic":
        return <em key={i}>{node.text}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-surface px-1 py-0.5 font-mono text-[12px] text-fg">
            {node.text}
          </code>
        );
    }
  });
}

function Lines({ lines }: { lines: Line[] }) {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      <InlineNodes nodes={line} />
    </Fragment>
  ));
}

/**
 * Rendu sûr du markdown minimal des réponses : uniquement des éléments React construits à
 * partir de nœuds de texte (jamais de HTML injecté).
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        if (block.type === "paragraph") {
          return (
            <p key={i}>
              <Lines lines={block.lines} />
            </p>
          );
        }
        if (block.type === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        const items = block.items.map((item, j) => (
          <li key={j} className="pl-1">
            <Lines lines={item} />
          </li>
        ));
        return block.ordered ? (
          <ol key={i} start={block.start} className="list-decimal space-y-1 pl-5 marker:text-muted">
            {items}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-subtle">
            {items}
          </ul>
        );
      })}
    </div>
  );
}
