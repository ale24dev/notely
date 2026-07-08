// Paleta de colores de sistema de Apple (Human Interface Guidelines).
export const PALETTE = [
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

/// Color de una etiqueta: el elegido por el usuario (overrides) o, por
/// defecto, uno estable derivado del nombre (hash djb2 sobre la paleta).
export function colorForTag(tag: string, overrides: Record<string, string>): string {
  const custom = overrides[tag];
  if (custom) return custom;
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) + hash + tag.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/// Color de texto legible sobre un fondo hex dado.
export function textOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1d1d1f" : "#ffffff";
}
