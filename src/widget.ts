import { listen } from "@tauri-apps/api/event";
import {
  getTagColors,
  listNotes,
  loadNote,
  openNoteInPopover,
  saveNote,
  type NoteMeta,
} from "./api";
import { colorForTag } from "./colors";
import { renderMarkdown, toggleTaskInContent } from "./markdown";
import { joinBody, splitBody } from "./noteContent";

const notesContainer = document.querySelector<HTMLElement>("#widget-notes")!;
const emptyState = document.querySelector<HTMLElement>("#widget-empty")!;

let tagColors: Record<string, string> = {};
// Contenido en memoria de cada nota mostrada, para alternar checkboxes
// sin releer del disco.
const contents = new Map<string, string>();

async function refresh() {
  const notes = await listNotes();
  try {
    tagColors = await getTagColors();
  } catch {
    // Colores por defecto.
  }

  // Notas fijadas; si no hay ninguna, las 3 más recientes.
  const pinned = notes.filter((n) => n.pinned);
  const shown = pinned.length > 0 ? pinned : notes.slice(0, 3);

  notesContainer.innerHTML = "";
  contents.clear();
  emptyState.classList.toggle("hidden", shown.length > 0);

  for (const note of shown) {
    contents.set(note.id, await loadNote(note.id));
    notesContainer.appendChild(buildCard(note));
  }
}

function buildCard(note: NoteMeta): HTMLElement {
  const card = document.createElement("article");
  card.className = "widget-card";

  const header = document.createElement("header");
  header.className = "widget-card-header";

  const title = document.createElement("button");
  title.className = "widget-card-title";
  title.textContent = note.title || "Sin título";
  title.title = "Abrir en Notely";
  title.addEventListener("click", () => void openNoteInPopover(note.id));
  header.appendChild(title);

  for (const tag of note.tags) {
    const color = colorForTag(tag, tagColors);
    const pill = document.createElement("span");
    pill.className = "note-tag";
    pill.textContent = `#${tag}`;
    pill.style.background = `color-mix(in srgb, ${color} 18%, transparent)`;
    pill.style.color = `color-mix(in srgb, ${color} 65%, var(--text))`;
    header.appendChild(pill);
  }

  const body = document.createElement("div");
  body.className = "markdown-body widget-card-body";
  renderBody(body, note.id);

  card.append(header, body);
  return card;
}

function renderBody(body: HTMLElement, id: string) {
  // El título ya se muestra en la cabecera de la tarjeta (se omite la
  // primera línea si es un encabezado), y las etiquetas del pie ya se
  // muestran como píldoras de color ahí mismo: no hace falta repetirlas
  // como texto crudo "#tag1 #tag2" dentro del Markdown renderizado.
  const content = contents.get(id) ?? "";
  const { body: withoutFooter } = splitBody(content);
  const withoutTitle = withoutFooter.replace(/^#{1,6}\s+.*\n?/, "");
  renderMarkdown(body, withoutTitle, (index) => void toggleTask(id, body, index));
}

async function toggleTask(id: string, cardBody: HTMLElement, index: number) {
  const content = contents.get(id);
  if (content === undefined) return;
  const { body: withoutFooter, footerTags } = splitBody(content);
  const withoutTitle = withoutFooter.replace(/^#{1,6}\s+.*\n?/, "");
  const updatedWithoutTitle = toggleTaskInContent(withoutTitle, index);
  if (updatedWithoutTitle === null) return;
  const title = withoutFooter.slice(0, withoutFooter.length - withoutTitle.length);
  const updated = joinBody(title + updatedWithoutTitle, footerTags);
  contents.set(id, updated);
  renderBody(cardBody, id);
  await saveNote(id, updated);
}

// Recarga cuando cambian las notas desde el popover (con un pequeño
// debounce: el propio guardado del widget también dispara el evento).
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
void listen("notes-changed", () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void refresh(), 300);
});

// Refresco periódico para fechas y cambios externos en disco.
setInterval(() => void refresh(), 5 * 60 * 1000);

void refresh();
