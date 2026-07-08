import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { PALETTE, colorForTag as colorFor, textOn } from "./colors";
import { renderMarkdown, toggleTaskInContent } from "./markdown";
import {
  createNote,
  deleteNote,
  deleteTagColor,
  getTagColors,
  getWidgetEnabled,
  listNotes,
  loadNote,
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
const tagsDatalist = document.querySelector<HTMLDataListElement>("#tags-datalist")!;

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

/// Todas las etiquetas visibles: las usadas en notas más las creadas
/// explícitamente (registradas en tagColors aunque aún no se usen).
function allTags(): string[] {
  return [...new Set([...notes.flatMap((n) => n.tags), ...Object.keys(tagColors)])].sort();
}

/// Normaliza el nombre de una etiqueta: sin '#', en minúsculas y solo
/// letras, números, guiones y guiones bajos (igual que el backend).
function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
  return /^[\p{L}\p{N}_-]+$/u.test(tag) ? tag : null;
}

/// Réplica en el cliente de extract_tags de Rust, para refrescar las
/// etiquetas del editor mientras se escribe sin ir al backend.
function extractTags(content: string): string[] {
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
      if (!token.startsWith("#") || token.startsWith("##")) continue;
      const match = token.slice(1).match(/^[\p{L}\p{N}_-]+/u);
      if (!match) continue;
      const tag = match[0].toLowerCase();
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.sort();
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
function renderEditorTags() {
  const tags = extractTags(editor.value);
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

  tagsDatalist.innerHTML = "";
  for (const tag of allTags()) {
    if (tags.includes(tag)) continue;
    const option = document.createElement("option");
    option.value = tag;
    tagsDatalist.appendChild(option);
  }
}

/// Añade `#tag` al final de la nota (reutilizando la última línea si ya
/// es una línea de etiquetas).
function addTagToNote(tag: string) {
  if (extractTags(editor.value).includes(tag)) return;
  if (editor.value.trim() === "") {
    editor.value = `#${tag}`;
  } else {
    const lines = editor.value.replace(/\s+$/, "").split("\n");
    const last = lines[lines.length - 1].trim();
    const isTagLine = last.length > 0 && last.split(/\s+/).every((t) => t.startsWith("#") && !t.startsWith("##"));
    if (isTagLine) {
      lines[lines.length - 1] += ` #${tag}`;
    } else {
      lines.push("", `#${tag}`);
    }
    editor.value = lines.join("\n");
  }
  scheduleSave();
  renderEditorTags();
}

/// Elimina todas las apariciones de `#tag` del texto (fuera de bloques de
/// código), limpiando las líneas que queden vacías.
function removeTagFromNote(tag: string) {
  const lines = editor.value.split("\n");
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
    const hadTag = line.split(/\s+/).some((t) => isTagToken(t, tag));
    if (!hadTag) {
      result.push(line);
      continue;
    }
    const cleaned = line
      .split(/\s+/)
      .filter((t) => !isTagToken(t, tag))
      .join(" ")
      .trimEnd();
    if (cleaned.trim() !== "") result.push(cleaned);
  }
  editor.value = result.join("\n").replace(/\n+$/, "\n").replace(/^\n+/, "");
  scheduleSave();
  renderEditorTags();
}

function isTagToken(token: string, tag: string): boolean {
  if (!token.startsWith("#") || token.startsWith("##")) return false;
  const match = token.slice(1).match(/^[\p{L}\p{N}_-]+/u);
  return match !== null && match[0].toLowerCase() === tag;
}

// ---- Editor ----
async function openNote(id: string) {
  currentId = id;
  currentPinned = notes.find((n) => n.id === id)?.pinned ?? false;
  editor.value = await loadNote(id);
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
  await saveNote(currentId, editor.value);
  saveStatus.textContent = "Guardado";
}

// ---- Vista previa: Markdown + checklists interactivas + resaltado ----
function renderPreview() {
  renderMarkdown(preview, editor.value, toggleTask);
}

function toggleTask(index: number) {
  const updated = toggleTaskInContent(editor.value, index);
  if (updated === null) return;
  editor.value = updated;
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
  scheduleSave();
  renderEditorTags();
});
searchInput.addEventListener("input", renderList);

// Añadir etiqueta a la nota abierta desde el campo del editor.
tagInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    const tag = normalizeTag(tagInput.value);
    if (tag !== null) addTagToNote(tag);
    tagInput.value = "";
  } else if (e.key === "Escape") {
    tagInput.value = "";
    tagInput.blur();
  }
});
// El autocompletado del datalist dispara "change" al elegir una opción.
tagInput.addEventListener("change", () => {
  const tag = normalizeTag(tagInput.value);
  if (tag !== null) addTagToNote(tag);
  tagInput.value = "";
});

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
