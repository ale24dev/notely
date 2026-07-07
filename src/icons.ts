// Iconos inline estilo Cupertino (SF Symbols): trazo fino con puntas
// redondeadas, dibujados sobre una retícula de 24×24 y teñidos con
// `currentColor` para heredar el color del botón y el tema claro/oscuro.

function icon(content: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    content +
    "</svg>"
  );
}

export const icons = {
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  power: icon('<path d="M12 3v8"/><path d="M17.66 6.34a8 8 0 1 1-11.32 0"/>'),
  chevronLeft: icon('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  trash: icon(
    '<path d="M4.5 7h15"/>' +
      '<path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/>' +
      '<path d="M6.5 7l.9 12.1a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"/>' +
      '<path d="M10 11v6M14 11v6"/>',
  ),
  pin: icon(
    '<path class="pin-body" d="M10 3h4a1 1 0 0 1 1 1v4.5l1.8 2.2a1 1 0 0 1-.78 1.63H8a1 1 0 0 1-.78-1.63L9 8.5V4a1 1 0 0 1 1-1z"/>' +
      '<path d="M12 12.5v8"/>',
  ),
};
