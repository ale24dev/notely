// Parsing de etiquetas y separación cuerpo/pie de una nota. Todo en el
// cliente, como réplica de extract_tags de Rust (que sigue operando sobre
// el contenido completo tal cual se guarda en disco — estas funciones solo
// deciden cómo se le presenta ese mismo contenido al usuario).

const TAG_TOKEN_RE = /^[\p{L}\p{N}_-]+/u;
const TAG_FULL_RE = /^[\p{L}\p{N}_-]+$/u;

/// Normaliza el nombre de una etiqueta: sin '#', en minúsculas y solo
/// letras, números, guiones y guiones bajos (igual que el backend).
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
  return TAG_FULL_RE.test(tag) ? tag : null;
}

/// Si `token` es una etiqueta `#nombre` (no un encabezado ni un `##`),
/// devuelve su nombre en minúsculas; si no, null.
function parseTagToken(token: string): string | null {
  if (!token.startsWith("#") || token.startsWith("##")) return null;
  const match = token.slice(1).match(TAG_TOKEN_RE);
  return match ? match[0].toLowerCase() : null;
}

/// Etiquetas presentes en cualquier parte del texto, ignorando bloques de
/// código — igual que extract_tags en Rust.
export function extractTags(content: string): string[] {
  const tags: string[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const token of line.split(/\s+/)) {
      const tag = parseTagToken(token);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.sort();
}

/// ¿Es `line` una línea compuesta solo por etiquetas (todas sus palabras
/// son tokens `#tag`)? Una línea vacía no cuenta.
function isTagOnlyLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => parseTagToken(t) !== null);
}

export interface SplitNote {
  body: string;
  footerTags: string[];
}

/// Separa el contenido guardado en "cuerpo" (lo que se edita como prosa) y
/// las etiquetas de su pie: si la última línea no vacía del contenido es
/// una línea compuesta solo por etiquetas — la que gestiona el pie del
/// editor —, se recorta del cuerpo y sus etiquetas pasan a `footerTags`.
/// Si no (nota vieja con tags mezclados en el texto, o sin pie), el cuerpo
/// es el contenido tal cual y footerTags queda vacío; esas etiquetas
/// inline se siguen detectando con `extractTags`, solo que no se separan.
export function splitBody(content: string): SplitNote {
  const lines = content.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  if (end === 0 || !isTagOnlyLine(lines[end - 1])) {
    return { body: content, footerTags: [] };
  }
  const footerTags = [
    ...new Set(
      lines[end - 1]
        .trim()
        .split(/\s+/)
        .map(parseTagToken)
        .filter((t): t is string => t !== null),
    ),
  ];
  const bodyLines = lines.slice(0, end - 1);
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();
  return { body: bodyLines.join("\n"), footerTags };
}

/// Reconstruye el contenido a guardar: el cuerpo seguido de una línea final
/// con las etiquetas del pie, si hay alguna.
export function joinBody(body: string, footerTags: string[]): string {
  if (footerTags.length === 0) return body;
  const tagLine = footerTags.map((t) => `#${t}`).join(" ");
  return body.trim() === "" ? tagLine : `${body.replace(/\s+$/, "")}\n\n${tagLine}`;
}

/// Elimina todas las apariciones de `#tag` del texto (fuera de bloques de
/// código), limpiando las líneas que queden vacías.
export function removeTagFromText(content: string, tag: string): string {
  const lines = content.split("\n");
  let inFence = false;
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    if (inFence) {
      result.push(line);
      continue;
    }
    const hadTag = line.split(/\s+/).some((t) => parseTagToken(t) === tag);
    if (!hadTag) {
      result.push(line);
      continue;
    }
    const cleaned = line
      .split(/\s+/)
      .filter((t) => parseTagToken(t) !== tag)
      .join(" ")
      .trimEnd();
    if (cleaned.trim() !== "") result.push(cleaned);
  }
  return result.join("\n").replace(/\n+$/, "\n").replace(/^\n+/, "");
}
