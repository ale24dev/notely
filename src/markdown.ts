import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";

marked.setOptions({ gfm: true, breaks: true });

/// Renderiza Markdown saneado dentro de `target`. Si se pasa
/// `onToggleTask`, las casillas `- [ ]` quedan habilitadas y al marcarlas
/// se invoca con su índice (el n-ésimo checkbox del documento).
export function renderMarkdown(
  target: HTMLElement,
  content: string,
  onToggleTask?: (index: number) => void,
): void {
  const html = marked.parse(content) as string;
  target.innerHTML = DOMPurify.sanitize(html);

  if (onToggleTask) {
    const boxes = target.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]');
    boxes.forEach((box, index) => {
      box.disabled = false;
      box.addEventListener("change", () => onToggleTask(index));
    });
  }

  for (const block of target.querySelectorAll<HTMLElement>("pre code")) {
    hljs.highlightElement(block);
  }
}

/// Alterna la n-ésima casilla `[ ]`/`[x]` del Markdown, ignorando bloques
/// de código (que no se renderizan como checkboxes). Devuelve el contenido
/// actualizado, o null si no se encontró la casilla.
export function toggleTaskInContent(content: string, index: number): string | null {
  const lines = content.split("\n");
  const taskRe = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
  let count = -1;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(taskRe);
    if (!m) continue;
    count++;
    if (count === index) {
      const toggled = m[2] === " " ? "x" : " ";
      lines[i] = m[1] + toggled + m[3] + lines[i].slice(m[0].length);
      return lines.join("\n");
    }
  }
  return null;
}
