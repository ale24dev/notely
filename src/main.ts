import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import {
  createNote,
  deleteNote,
  getTagColors,
  listNotes,
  loadNote,
  quitApp,
  saveNote,
  setTagColor,
  togglePin,
  type NoteMeta,
} from "./api";
import { icons } from "./icons";

marked.setOptions({ gfm: true, breaks: true });

// ---- Elementos del DOM ----
const listView = document.querySelector<HTMLElement>("#list-view")!;
const editorView = document.querySelector<HTMLElement>("#editor-view")!;
const notesList = document.querySelector<HTMLUListElement>("#notes-list")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
const tagsBar = document.querySelector<HTMLElement>("#tags-bar")!;
const newNoteBtn = document.querySelector<HTMLButtonElement>("#new-note-btn")!;
const quitBtn = document.querySelector<HTMLButtonElement>("#quit-btn")!;
const backBtn = document.querySelector<HTMLButtonElement>("#back-btn")!;
const deleteBtn = document.querySelector<HTMLButtonElement>("#delete-note-btn")!;
const pinBtn = document.querySelector<HTMLButtonElement>("#pin-note-btn")!;
const previewBtn = document.querySelector<HTMLButtonElement>("#toggle-preview-btn")!;
const editor = document.querySelector<HTMLTextAreaElement>("#note-editor")!;
const preview = document.querySelector<HTMLElement>("#note-preview")!;
const saveStatus = document.querySelector<HTMLElement>("#save-status")!;
const autostartToggle = document.querySelector<HTMLInputElement>("#autostart-toggle")!;

// Iconos estilo Cupertino (SVG estáticos propios, no contenido de usuario).
newNoteBtn.innerHTML = icons.plus;
quitBtn.innerHTML = icons.power;
backBtn.innerHTML = icons.chevronLeft;
deleteBtn.innerHTML = icons.trash;
pinBtn.innerHTML = icons.pin;

// ---- Estado ----
let notes: NoteMeta[] = [];
let currentId: string | null = null;
let currentPinned = false;
let previewMode = false;
let activeTag: string | null = null;
let tagColors: Record<string, string> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

// ---- Colores de etiquetas ----
// Paleta de colores de sistema de Apple (Human Interface Guidelines).
const PALETTE = [
  "#ff3b30", // rojo
  "#ff9500", // naranja
  "#ffcc00", // amarillo
  "#34c759", // verde
  "#00c7be", // menta
  "#007aff", // azul
  "#af52de", // morado
  "#ff2d55", // rosa
  "#8e8e93", // gris
];

/// Color de una etiqueta: el elegido por el usuario o, por defecto, uno
/// estable derivado del nombre (hash djb2 sobre la paleta).
function colorForTag(tag: string): string {
  const custom = tagColors[tag];
  if (custom) return custom;
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) + hash + tag.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/// Color de texto legible sobre un fondo hex dado.
function textOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1d1d1f" : "#ffffff";
}

// Selector de color flotante, compartido por todos los chips.
const colorPicker = document.createElement("div");
colorPicker.id = "color-picker";
colorPicker.classList.add("hidden");
document.body.appendChild(colorPicker);

function openColorPicker(tag: string, anchor: HTMLElement) {
  colorPicker.innerHTML = "";
  const current = colorForTag(tag);
  for (const color of PALETTE) {
    const swatch = document.createElement("button");
    swatch.className = "swatch" + (color === current ? " selected" : "");
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      tagColors[tag] = color;
      closeColorPicker();
      renderTags();
      renderList();
      void setTagColor(tag, color);
    });
    colorPicker.appendChild(swatch);
  }
  colorPicker.classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - colorPicker.offsetWidth - 8));
  colorPicker.style.left = `${left}px`;
  colorPicker.style.top = `${rect.bottom + 6}px`;
}

function closeColorPicker() {
  colorPicker.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (!colorPicker.contains(e.target as Node)) closeColorPicker();
});

// ---- Lista de notas ----
async function refreshList() {
  notes = await listNotes();
  renderTags();
  renderList();
}

function renderTags() {
  const tags = [...new Set(notes.flatMap((n) => n.tags))].sort();
  if (activeTag !== null && !tags.includes(activeTag)) {
    activeTag = null;
  }
  tagsBar.innerHTML = "";
  for (const tag of tags) {
    const color = colorForTag(tag);
    const chip = document.createElement("button");
    chip.className = "tag-chip";
    chip.title = "Filtrar por etiqueta · clic en el punto para cambiar el color";

    const dot = document.createElement("span");
    dot.className = "tag-dot";
    dot.style.background = color;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      openColorPicker(tag, chip);
    });

    const label = document.createElement("span");
    label.textContent = `#${tag}`;

    chip.append(dot, label);

    if (tag === activeTag) {
      chip.classList.add("active");
      chip.style.background = color;
      chip.style.borderColor = color;
      chip.style.color = textOn(color);
    }

    chip.addEventListener("click", () => {
      activeTag = tag === activeTag ? null : tag;
      renderTags();
      renderList();
    });
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorPicker(tag, chip);
    });
    tagsBar.appendChild(chip);
  }
  tagsBar.classList.toggle("hidden", tags.length === 0);
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  let visible = activeTag !== null ? notes.filter((n) => n.tags.includes(activeTag!)) : notes;
  if (query) {
    visible = visible.filter(
      (n) =>
        n.title.toLowerCase().includes(query) ||
        n.preview.toLowerCase().includes(query) ||
        n.tags.some((t) => t.includes(query.replace(/^#/, ""))),
    );
  }

  notesList.innerHTML = "";
  for (const note of visible) {
    const li = document.createElement("li");
    li.className = "note-item";

    const titleRow = document.createElement("span");
    titleRow.className = "note-title";
    if (note.pinned) {
      const pin = document.createElement("span");
      pin.className = "pin-badge";
      pin.innerHTML = icons.pin;
      titleRow.appendChild(pin);
    }
    const titleText = document.createElement("span");
    titleText.className = "note-title-text";
    titleText.textContent = note.title || "Sin título";
    titleRow.appendChild(titleText);

    const meta = document.createElement("span");
    meta.className = "note-meta";
    const date = document.createElement("span");
    date.textContent = formatDate(note.updated_at);
    const previewText = document.createElement("span");
    previewText.className = "note-preview";
    previewText.textContent = note.preview;
    meta.append(date, previewText);

    li.append(titleRow, meta);

    if (note.tags.length > 0) {
      const tagRow = document.createElement("span");
      tagRow.className = "note-tags";
      for (const tag of note.tags) {
        const color = colorForTag(tag);
        const pill = document.createElement("span");
        pill.className = "note-tag";
        pill.textContent = `#${tag}`;
        pill.style.background = `color-mix(in srgb, ${color} 18%, transparent)`;
        pill.style.color = `color-mix(in srgb, ${color} 65%, var(--text))`;
        tagRow.appendChild(pill);
      }
      li.appendChild(tagRow);
    }

    li.addEventListener("click", () => openNote(note.id));
    notesList.appendChild(li);
  }

  emptyState.classList.toggle("hidden", notes.length > 0);
  notesList.classList.toggle("hidden", visible.length === 0);
}

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ---- Editor ----
async function openNote(id: string) {
  currentId = id;
  currentPinned = notes.find((n) => n.id === id)?.pinned ?? false;
  editor.value = await loadNote(id);
  dirty = false;
  saveStatus.textContent = "";
  updatePinButton();
  setPreviewMode(false);
  listView.classList.add("hidden");
  editorView.classList.remove("hidden");
  editor.focus();
}

async function closeEditor() {
  await flushSave();
  currentId = null;
  editorView.classList.add("hidden");
  listView.classList.remove("hidden");
  await refreshList();
}

function scheduleSave() {
  dirty = true;
  saveStatus.textContent = "Escribiendo…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty || currentId === null) return;
  dirty = false;
  await saveNote(currentId, editor.value);
  saveStatus.textContent = "Guardado";
}

// ---- Vista previa: Markdown + checklists interactivas + resaltado ----
function renderPreview() {
  const html = marked.parse(editor.value) as string;
  preview.innerHTML = DOMPurify.sanitize(html);

  // Las checklists de la vista previa se pueden marcar/desmarcar y el
  // cambio se escribe de vuelta en el Markdown.
  const boxes = preview.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]');
  boxes.forEach((box, index) => {
    box.disabled = false;
    box.addEventListener("change", () => toggleTask(index));
  });

  for (const block of preview.querySelectorAll<HTMLElement>("pre code")) {
    hljs.highlightElement(block);
  }
}

/// Alterna la n-ésima casilla `[ ]`/`[x]` del Markdown, ignorando bloques
/// de código (que no se renderizan como checkboxes).
function toggleTask(index: number) {
  const lines = editor.value.split("\n");
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
      editor.value = lines.join("\n");
      scheduleSave();
      renderPreview();
      return;
    }
  }
}

function setPreviewMode(on: boolean) {
  previewMode = on;
  if (on) {
    renderPreview();
  }
  editor.classList.toggle("hidden", on);
  preview.classList.toggle("hidden", !on);
  previewBtn.classList.toggle("active", on);
  previewBtn.textContent = on ? "Editar" : "Vista previa";
  if (!on) editor.focus();
}

// ---- Fijar notas ----
function updatePinButton() {
  pinBtn.classList.toggle("pinned", currentPinned);
  pinBtn.title = currentPinned ? "Dejar de fijar" : "Fijar nota arriba";
}

async function togglePinCurrent() {
  if (currentId === null) return;
  currentPinned = await togglePin(currentId);
  updatePinButton();
}

// ---- Acciones ----
async function newNote() {
  const note = await createNote();
  notes.unshift(note);
  await openNote(note.id);
}

async function removeCurrentNote() {
  if (currentId === null) return;
  const id = currentId;
  currentId = null;
  dirty = false;
  clearTimeout(saveTimer);
  await deleteNote(id);
  editorView.classList.add("hidden");
  listView.classList.remove("hidden");
  await refreshList();
}

async function quit() {
  await flushSave();
  await quitApp();
}

// ---- Autostart ----
async function initAutostart() {
  try {
    autostartToggle.checked = await isEnabled();
  } catch {
    // El plugin puede no estar disponible (p. ej. permisos); se deja apagado.
  }
  autostartToggle.addEventListener("change", async () => {
    try {
      if (autostartToggle.checked) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      autostartToggle.checked = !autostartToggle.checked;
    }
  });
}

// ---- Eventos ----
newNoteBtn.addEventListener("click", newNote);
quitBtn.addEventListener("click", quit);
backBtn.addEventListener("click", closeEditor);
deleteBtn.addEventListener("click", removeCurrentNote);
pinBtn.addEventListener("click", togglePinCurrent);
previewBtn.addEventListener("click", () => setPreviewMode(!previewMode));
editor.addEventListener("input", scheduleSave);
searchInput.addEventListener("input", renderList);

document.addEventListener("keydown", (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key === "q") {
    e.preventDefault();
    void quit();
  } else if (cmd && e.key === "n") {
    e.preventDefault();
    void newNote();
  } else if (cmd && e.key === "e" && currentId !== null) {
    e.preventDefault();
    setPreviewMode(!previewMode);
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (!colorPicker.classList.contains("hidden")) {
      closeColorPicker();
    } else if (currentId !== null) {
      void closeEditor();
    } else {
      void getCurrentWindow().hide();
    }
  }
});

// Guarda los cambios pendientes cuando la ventana pierde el foco
// (p. ej. al cerrarse el popover al hacer clic fuera).
void getCurrentWindow().listen("tauri://blur", () => {
  void flushSave();
});

// Tab inserta tabulación en lugar de mover el foco.
editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const { selectionStart, selectionEnd, value } = editor;
    editor.value = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
    editor.selectionStart = editor.selectionEnd = selectionStart + 2;
    scheduleSave();
  }
});

async function init() {
  try {
    tagColors = await getTagColors();
  } catch {
    // Sin colores personalizados; se usan los de la paleta por defecto.
  }
  await refreshList();
}

void init();
void initAutostart();
