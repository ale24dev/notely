import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { PALETTE, colorForTag as colorFor, textOn } from "./colors";
import { renderMarkdown, toggleTaskInContent } from "./markdown";
import { extractTags, joinBody, normalizeTag, removeTagFromText, splitBody } from "./noteContent";
import {
  createNote,
  deleteNote,
  deleteTagColor,
  getTagColors,
  getWidgetEnabled,
  isSandboxed,
  listNotes,
  loadNote,
  pasteFromClipboard,
  quitApp,
  saveNote,
  setTagColor,
  setWidgetEnabled,
  togglePin,
  type NoteMeta,
} from "./api";
import { icons } from "./icons";

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
const widgetToggle = document.querySelector<HTMLInputElement>("#widget-toggle")!;
const editorTagPills = document.querySelector<HTMLElement>("#editor-tag-pills")!;
const tagInput = document.querySelector<HTMLInputElement>("#tag-input")!;
const tagSuggestions = document.querySelector<HTMLElement>("#tag-suggestions")!;

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
/// Etiquetas gestionadas desde el pie de la nota abierta (separadas del
/// cuerpo editable; ver src/noteContent.ts). Las que el usuario escribe a
/// mano dentro del texto siguen detectándose con extractTags aparte.
let footerTags: string[] = [];

// ---- Colores de etiquetas ----

/// Todas las etiquetas visibles: las usadas en notas más las creadas
/// explícitamente (registradas en tagColors aunque aún no se usen).
function allTags(): string[] {
  return [...new Set([...notes.flatMap((n) => n.tags), ...Object.keys(tagColors)])].sort();
}

function colorForTag(tag: string): string {
  return colorFor(tag, tagColors);
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
  // Una etiqueta creada pero sin usar en ninguna nota se puede quitar.
  if (!notes.some((n) => n.tags.includes(tag))) {
    const remove = document.createElement("button");
    remove.className = "picker-remove";
    remove.textContent = "Quitar";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      delete tagColors[tag];
      if (activeTag === tag) activeTag = null;
      closeColorPicker();
      renderTags();
      renderList();
      void deleteTagColor(tag);
    });
    colorPicker.appendChild(remove);
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
  if (!tagSuggestions.contains(e.target as Node) && e.target !== tagInput) closeTagSuggestions();
});

// ---- Lista de notas ----
async function refreshList() {
  notes = await listNotes();
  renderTags();
  renderList();
}

function renderTags() {
  const tags = allTags();
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
    chip.dataset.tag = tag;
    tagsBar.appendChild(chip);
  }

  // Chip para crear una etiqueta nueva sin tener que escribir #tag a mano.
  const addChip = document.createElement("button");
  addChip.className = "tag-chip add-tag";
  addChip.title = "Crear etiqueta";
  addChip.innerHTML = `${icons.plus}<span>etiqueta</span>`;

  const newTagInput = document.createElement("input");
  newTagInput.className = "new-tag-input hidden";
  newTagInput.placeholder = "nombre…";
  newTagInput.spellcheck = false;

  addChip.addEventListener("click", () => {
    addChip.classList.add("hidden");
    newTagInput.classList.remove("hidden");
    newTagInput.focus();
  });
  newTagInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      void createTag(newTagInput.value);
    } else if (e.key === "Escape") {
      renderTags();
    }
  });
  newTagInput.addEventListener("blur", () => {
    if (!newTagInput.classList.contains("hidden")) renderTags();
  });

  tagsBar.append(addChip, newTagInput);
}

/// Registra una etiqueta nueva (persistiendo su color por defecto) y abre
/// el selector de color sobre su chip recién creado.
async function createTag(raw: string) {
  const tag = normalizeTag(raw);
  if (tag === null) {
    renderTags();
    return;
  }
  const color = colorForTag(tag);
  tagColors[tag] = color;
  renderTags();
  const chip = tagsBar.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag)}"]`);
  if (chip) openColorPicker(tag, chip);
  try {
    await setTagColor(tag, color);
  } catch {
    // Si falla la persistencia, el color por defecto seguirá aplicándose.
  }
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

// ---- Etiquetas de la nota abierta ----
/// Todas las etiquetas de la nota abierta: las del pie más las que el
/// usuario haya escrito a mano dentro del texto.
function currentNoteTags(): string[] {
  return [...new Set([...extractTags(editor.value), ...footerTags])].sort();
}

function renderEditorTags() {
  const tags = currentNoteTags();
  editorTagPills.innerHTML = "";
  for (const tag of tags) {
    const color = colorForTag(tag);
    const pill = document.createElement("span");
    pill.className = "note-tag editor-pill";
    pill.style.background = `color-mix(in srgb, ${color} 18%, transparent)`;
    pill.style.color = `color-mix(in srgb, ${color} 65%, var(--text))`;
    pill.appendChild(document.createTextNode(`#${tag}`));

    const remove = document.createElement("button");
    remove.className = "pill-remove";
    remove.textContent = "×";
    remove.title = "Quitar etiqueta de la nota";
    remove.addEventListener("click", () => removeTagFromNote(tag));
    pill.appendChild(remove);

    editorTagPills.appendChild(pill);
  }
}

/// Añade una etiqueta al pie de la nota (no toca el cuerpo/textarea).
function addTagToNote(tag: string) {
  if (currentNoteTags().includes(tag)) return;
  footerTags.push(tag);
  scheduleSave();
  renderEditorTags();
  if (previewMode) renderPreviewFooter();
}

/// Quita una etiqueta: del pie si estaba ahí, y de cualquier mención suelta
/// dentro del cuerpo si el usuario la había escrito a mano.
function removeTagFromNote(tag: string) {
  if (footerTags.includes(tag)) {
    footerTags = footerTags.filter((t) => t !== tag);
  }
  if (extractTags(editor.value).includes(tag)) {
    editor.value = removeTagFromText(editor.value, tag);
    recordChange(true);
  }
  scheduleSave();
  renderEditorTags();
  if (previewMode) renderPreviewFooter();
}

// ---- Dropdown de sugerencias del campo "+ etiqueta" ----
// Un <datalist> nativo no se puede colorear (lo pinta el sistema, no el
// webview); este desplegable es propio para poder mostrar el punto de
// color de cada etiqueta, igual que en los chips de filtro y las píldoras.
let tagSuggestionsList: string[] = [];
let tagSuggestionIndex = -1;

function updateTagSuggestions() {
  const query = tagInput.value.trim().replace(/^#/, "").toLowerCase();
  const existing = new Set(currentNoteTags());
  tagSuggestionsList = allTags()
    .filter((t) => !existing.has(t))
    .filter((t) => query === "" || t.includes(query))
    .slice(0, 8);
  tagSuggestionIndex = -1;
  renderTagSuggestions();
}

function renderTagSuggestions() {
  tagSuggestions.innerHTML = "";
  if (tagSuggestionsList.length === 0) {
    tagSuggestions.classList.add("hidden");
    return;
  }
  tagSuggestionsList.forEach((tag, i) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tag-suggestion" + (i === tagSuggestionIndex ? " active" : "");

    const dot = document.createElement("span");
    dot.className = "tag-suggestion-dot";
    dot.style.background = colorForTag(tag);

    item.append(dot, document.createTextNode(`#${tag}`));
    // mousedown (no click) para leer la selección antes de que el input
    // pierda el foco y se cierre el desplegable.
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      addTagToNote(tag);
      tagInput.value = "";
      closeTagSuggestions();
    });
    tagSuggestions.appendChild(item);
  });
  tagSuggestions.classList.remove("hidden");
}

function closeTagSuggestions() {
  tagSuggestions.classList.add("hidden");
  tagSuggestionsList = [];
  tagSuggestionIndex = -1;
}

// ---- Historial de deshacer/rehacer del editor ----
// El deshacer nativo del textarea no sobrevive a las ediciones
// programáticas (pegar, checkboxes, etiquetas) ni al enrutado de atajos de
// una menubar app, así que se lleva un historial propio por nota.
let undoStack: string[] = [];
let redoStack: string[] = [];
let historyValue = "";
let lastSnapshot = 0;

function resetHistory() {
  undoStack = [];
  redoStack = [];
  historyValue = editor.value;
  lastSnapshot = 0;
}

/// Registra el estado previo del editor tras un cambio. Las ráfagas de
/// tecleo (<600 ms entre pulsaciones) se agrupan en un solo paso; las
/// ediciones programáticas fuerzan su propio paso con `force`.
function recordChange(force = false) {
  if (editor.value === historyValue) return;
  const now = Date.now();
  if (force || now - lastSnapshot > 600) {
    undoStack.push(historyValue);
    if (undoStack.length > 200) undoStack.shift();
  }
  lastSnapshot = now;
  redoStack = [];
  historyValue = editor.value;
}

function undo() {
  const previous = undoStack.pop();
  if (previous === undefined) return;
  redoStack.push(editor.value);
  applyHistory(previous);
}

function redo() {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(editor.value);
  applyHistory(next);
}

function applyHistory(value: string) {
  const cursor = firstDiffIndex(editor.value, value);
  editor.value = value;
  historyValue = value;
  lastSnapshot = Date.now();
  editor.selectionStart = editor.selectionEnd = Math.min(cursor, value.length);
  editor.focus();
  scheduleSave();
  renderEditorTags();
}

function firstDiffIndex(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

// ---- Editor ----
async function openNote(id: string) {
  currentId = id;
  currentPinned = notes.find((n) => n.id === id)?.pinned ?? false;
  const split = splitBody(await loadNote(id));
  editor.value = split.body;
  footerTags = split.footerTags;
  resetHistory();
  dirty = false;
  saveStatus.textContent = "";
  updatePinButton();
  renderEditorTags();
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
  await saveNote(currentId, joinBody(editor.value, footerTags));
  saveStatus.textContent = "Guardado";
}

// ---- Vista previa: Markdown + checklists interactivas + resaltado ----
function renderPreview() {
  renderMarkdown(preview, editor.value, toggleTask);
  renderPreviewFooter();
}

/// Pie de etiquetas de la vista previa: chips de color, no el texto crudo
/// "#tag1 #tag2" como un párrafo más del Markdown renderizado.
function renderPreviewFooter() {
  let footer = preview.querySelector<HTMLElement>(".preview-tags-footer");
  const tags = currentNoteTags();
  if (tags.length === 0) {
    footer?.remove();
    return;
  }
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "preview-tags-footer";
    preview.appendChild(footer);
  }
  footer.innerHTML = "";
  for (const tag of tags) {
    const color = colorForTag(tag);
    const pill = document.createElement("span");
    pill.className = "note-tag";
    pill.textContent = `#${tag}`;
    pill.style.background = `color-mix(in srgb, ${color} 18%, transparent)`;
    pill.style.color = `color-mix(in srgb, ${color} 65%, var(--text))`;
    footer.appendChild(pill);
  }
}

function toggleTask(index: number) {
  const updated = toggleTaskInContent(editor.value, index);
  if (updated === null) return;
  editor.value = updated;
  recordChange(true);
  scheduleSave();
  renderPreview();
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
  // En el build de la Mac App Store (App Sandbox) el autostart por
  // LaunchAgent no está permitido: se oculta la opción.
  try {
    if (await isSandboxed()) {
      autostartToggle.closest("label")?.classList.add("hidden");
      return;
    }
  } catch {
    // Si no se puede determinar, se muestra la opción normalmente.
  }
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

// ---- Widget de escritorio ----
async function initWidgetToggle() {
  try {
    widgetToggle.checked = await getWidgetEnabled();
  } catch {
    // Sin ajuste guardado; se deja apagado.
  }
  widgetToggle.addEventListener("change", async () => {
    try {
      await setWidgetEnabled(widgetToggle.checked);
    } catch {
      widgetToggle.checked = !widgetToggle.checked;
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
editor.addEventListener("input", () => {
  recordChange();
  scheduleSave();
  renderEditorTags();
});
searchInput.addEventListener("input", renderList);

// Añadir etiqueta a la nota abierta desde el campo del editor, con
// desplegable propio (con colores) en vez del datalist nativo del sistema.
tagInput.addEventListener("input", updateTagSuggestions);
tagInput.addEventListener("focus", updateTagSuggestions);
tagInput.addEventListener("blur", () => {
  // Retraso corto: si el blur lo provocó un clic en una sugerencia, su
  // propio mousedown (que se dispara antes) ya la habrá seleccionado.
  setTimeout(closeTagSuggestions, 100);
});
tagInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (tagSuggestionsList.length === 0) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    tagSuggestionIndex =
      (tagSuggestionIndex + delta + tagSuggestionsList.length) % tagSuggestionsList.length;
    renderTagSuggestions();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const tag =
      tagSuggestionIndex >= 0 ? tagSuggestionsList[tagSuggestionIndex] : normalizeTag(tagInput.value);
    if (tag !== null) addTagToNote(tag);
    tagInput.value = "";
    closeTagSuggestions();
  } else if (e.key === "Escape") {
    if (tagSuggestionsList.length > 0) {
      closeTagSuggestions();
    } else {
      tagInput.value = "";
      tagInput.blur();
    }
  }
});

// ---- Portapapeles ----
// Una menubar app sin foco de aplicación no siempre recibe los atajos de
// edición nativos, así que se implementan a mano para cualquier campo.
type TextField = HTMLInputElement | HTMLTextAreaElement;

function activeTextField(): TextField | null {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null;
}

function insertIntoField(field: TextField, text: string) {
  // Pegar/cortar en el editor merece su propio paso de deshacer, aunque
  // llegue en medio de una ráfaga de tecleo.
  if (field === editor) lastSnapshot = 0;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + text + field.value.slice(end);
  field.selectionStart = field.selectionEnd = start + text.length;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function pasteIntoField(field: TextField) {
  const result = await pasteFromClipboard();
  if (result.kind === "text") {
    insertIntoField(field, result.text);
  } else if (result.kind === "image" && field === editor) {
    // Las imágenes solo tienen sentido dentro de la nota; se inserta la
    // referencia y el usuario decide cuándo abrir la vista previa.
    insertIntoField(field, result.markdown);
  }
}

async function copySelection(field: TextField, cut: boolean) {
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  if (start === end) return;
  await writeText(field.value.slice(start, end));
  if (cut) insertIntoField(field, "");
}

document.addEventListener("keydown", (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  const field = activeTextField();
  // Deshacer/rehacer del editor: ⌘Z / ⇧⌘Z (también ⌘Y para rehacer).
  if (cmd && field === editor && !e.altKey) {
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (e.key.toLowerCase() === "y" && !e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
  }
  if (cmd && field !== null && !e.shiftKey && !e.altKey) {
    if (e.key === "v") {
      e.preventDefault();
      void pasteIntoField(field);
      return;
    }
    if (e.key === "c" || e.key === "x") {
      e.preventDefault();
      void copySelection(field, e.key === "x");
      return;
    }
    if (e.key === "a") {
      e.preventDefault();
      field.select();
      return;
    }
  }
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
// (p. ej. al cerrarse el popover al hacer clic fuera). En macOS el panel
// emite "panel-blur" desde Rust; en otras plataformas llega tauri://blur.
void getCurrentWindow().listen("tauri://blur", () => {
  void flushSave();
});
void listen("panel-blur", () => {
  void flushSave();
});

// El widget de escritorio pide abrir una nota en el popover.
void listen<string>("open-note", (event) => {
  void openNote(event.payload);
});

// Las notas cambiaron desde otra ventana (p. ej. checkbox marcado en el
// widget): refresca la lista si no hay una nota abierta en el editor.
void listen("notes-changed", () => {
  if (currentId === null) void refreshList();
});

// Tab inserta tabulación en lugar de mover el foco.
editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const { selectionStart, selectionEnd, value } = editor;
    editor.value = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
    editor.selectionStart = editor.selectionEnd = selectionStart + 2;
    recordChange(true);
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
void initWidgetToggle();
