import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  id: string;
  title: string;
  preview: string;
  updated_at: number;
  pinned: boolean;
  tags: string[];
}

export function listNotes(): Promise<NoteMeta[]> {
  return invoke("list_notes");
}

export function loadNote(id: string): Promise<string> {
  return invoke("load_note", { id });
}

export function saveNote(id: string, content: string): Promise<void> {
  return invoke("save_note", { id, content });
}

export function createNote(): Promise<NoteMeta> {
  return invoke("create_note");
}

export function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

export function togglePin(id: string): Promise<boolean> {
  return invoke("toggle_pin", { id });
}

export function getTagColors(): Promise<Record<string, string>> {
  return invoke("get_tag_colors");
}

export function setTagColor(tag: string, color: string): Promise<void> {
  return invoke("set_tag_color", { tag, color });
}

export function deleteTagColor(tag: string): Promise<void> {
  return invoke("delete_tag_color", { tag });
}

export function getWidgetEnabled(): Promise<boolean> {
  return invoke("get_widget_enabled");
}

export function setWidgetEnabled(enabled: boolean): Promise<void> {
  return invoke("set_widget_enabled", { enabled });
}

export type Theme = "light" | "dark" | "system";

export function getTheme(): Promise<Theme> {
  return invoke("get_theme");
}

export function setTheme(theme: Theme): Promise<void> {
  return invoke("set_theme", { theme });
}

export function openNoteInPopover(id: string): Promise<void> {
  return invoke("open_note", { id });
}

export function openSettings(): Promise<void> {
  return invoke("open_settings");
}

export type PasteResult =
  | { kind: "text"; text: string }
  | { kind: "image"; markdown: string }
  | { kind: "empty" };

export function pasteFromClipboard(): Promise<PasteResult> {
  return invoke("paste_from_clipboard");
}

export function isSandboxed(): Promise<boolean> {
  return invoke("is_sandboxed");
}

export function quitApp(): Promise<void> {
  return invoke("quit");
}
