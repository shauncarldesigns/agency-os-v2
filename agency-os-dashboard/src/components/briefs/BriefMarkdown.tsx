import type { ReactNode } from 'react';

interface BriefMarkdownProps {
  markdown: string;
}

// Lightweight syntax-highlighted view for brief markdown. Same vibe as the
// previous BriefEditor in build/, just renamed and simplified.
export function BriefMarkdown({ markdown }: BriefMarkdownProps) {
  const lines = markdown.split('\n');
  const rendered: ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# ')) {
      rendered.push(<span key={i} className="brief-h1">{line.slice(2)}</span>);
    } else if (line.startsWith('## ')) {
      rendered.push(<span key={i} className="brief-h2">{line}</span>);
    } else if (line.startsWith('### ')) {
      rendered.push(<span key={i} className="brief-h3">{line}</span>);
    } else if (line.startsWith('---')) {
      rendered.push(<div key={i} className="brief-divider" />);
    } else {
      rendered.push(<span key={i} dangerouslySetInnerHTML={{ __html: highlightBold(escapeHtml(line)) }} />);
    }
    if (i < lines.length - 1) rendered.push('\n');
  }

  return <div className="brief-editor">{rendered}</div>;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong class="brief-md-strong">$1</strong>');
}
