import { Fragment, type ReactNode } from 'react';

/**
 * Renders assistant text with a deliberately tiny subset of Markdown:
 * paragraphs, "- " / "1." lists and **bold**. Everything is emitted as React
 * text nodes, so model output can never become HTML, links or scripts.
 */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function SafeText({ text }: { text: string }) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const firstBullet = lines.findIndex((l) => BULLET.test(l));
        if (firstBullet === -1) {
          return (
            <p key={i} className="mb-3 last:mb-0">
              {inline(lines.join(' '))}
            </p>
          );
        }
        const intro = lines.slice(0, firstBullet);
        const items = lines.slice(firstBullet);
        return (
          <Fragment key={i}>
            {intro.length > 0 && <p className="mb-2">{inline(intro.join(' '))}</p>}
            <ul className="mb-3 list-disc ps-6 last:mb-0">
              {items.map((item, j) => (
                <li key={j} className="mb-1">
                  {inline(item.replace(BULLET, ''))}
                </li>
              ))}
            </ul>
          </Fragment>
        );
      })}
    </>
  );
}
