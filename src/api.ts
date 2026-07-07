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

export function quitApp(): Promise<void> {
  return invoke("quit");
}
