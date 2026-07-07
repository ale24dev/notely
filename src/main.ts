import { getCurrentWindow } from "@tauri-apps/api/window";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { createNote, deleteNote, listNotes, loadNote, saveNote, type NoteMeta } from "./api";

marked.setOptions({ gfm: true, breaks: true });

// ---- Elementos del DOM ----
const listView = document.querySelector<HTMLElement>("#list-view")!;
const editorView = document.querySelector<HTMLElement>("#editor-view")!;
const notesList = document.querySelector<HTMLUListElement>("#notes-list")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
const newNoteBtn = document.querySelector<HTMLButtonElement>("#new-note-btn")!;
const backBtn = document.querySelector<HTMLButtonElement>("#back-btn")!;
const deleteBtn = document.querySelector<HTMLButtonElement>("#delete-note-btn")!;
const previewBtn = document.querySelector<HTMLButtonElement>("#toggle-preview-btn")!;
const editor = document.querySelector<HTMLTextAreaElement>("#note-editor")!;
const preview = document.querySelector<HTMLElement>("#note-preview")!;
const saveStatus = document.querySelector<HTMLElement>("#save-status")!;

// ---- Estado ----
let notes: NoteMeta[] = [];
let currentId: string | null = null;
let previewMode = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

// ---- Lista de notas ----
async function refreshList() {
  notes = await listNotes();
  renderList();
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = query
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(query) || n.preview.toLowerCase().includes(query),
      )
    : notes;

  notesList.innerHTML = "";
  for (const note of visible) {
    const li = document.createElement("li");
    li.className = "note-item";

    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = note.title || "Sin título";

    const meta = document.createElement("span");
    meta.className = "note-meta";
    const date = document.createElement("span");
    date.textContent = formatDate(note.updated_at);
    const previewText = document.createElement("span");
    previewText.className = "note-preview";
    previewText.textContent = note.preview;
    meta.append(date, previewText);

    li.append(title, meta);
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
  editor.value = await loadNote(id);
  dirty = false;
  saveStatus.textContent = "";
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

function setPreviewMode(on: boolean) {
  previewMode = on;
  if (on) {
    const html = marked.parse(editor.value) as string;
    preview.innerHTML = DOMPurify.sanitize(html);
  }
  editor.classList.toggle("hidden", on);
  preview.classList.toggle("hidden", !on);
  previewBtn.classList.toggle("active", on);
  previewBtn.textContent = on ? "Editar" : "Vista previa";
  if (!on) editor.focus();
}

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

// ---- Eventos ----
newNoteBtn.addEventListener("click", newNote);
backBtn.addEventListener("click", closeEditor);
deleteBtn.addEventListener("click", removeCurrentNote);
previewBtn.addEventListener("click", () => setPreviewMode(!previewMode));
editor.addEventListener("input", scheduleSave);
searchInput.addEventListener("input", renderList);

document.addEventListener("keydown", (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key === "n") {
    e.preventDefault();
    void newNote();
  } else if (cmd && e.key === "e" && currentId !== null) {
    e.preventDefault();
    setPreviewMode(!previewMode);
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (currentId !== null) {
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

void refreshList();
