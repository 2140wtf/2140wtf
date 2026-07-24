/** CSS properties that affect text layout and must be copied to the mirror element. */
const MIRROR_PROPS = [
  "direction", "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
  "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform",
  "textIndent", "textDecoration", "letterSpacing", "wordSpacing",
  "tabSize", "MozTabSize", "whiteSpace", "wordWrap", "wordBreak",
] as const;

/**
 * Returns the pixel {top, left} of a character position within a textarea or
 * single-line input, relative to the element's top-left corner. Uses a hidden
 * mirror element that clones the element's layout-affecting styles.
 */
export function getCaretCoordinates(element: HTMLTextAreaElement | HTMLInputElement, position: number): { top: number; left: number } {
  const mirror = document.createElement("div");

  const style = window.getComputedStyle(element);

  for (const prop of MIRROR_PROPS) {
    mirror.style[prop as string] = style.getPropertyValue(
      prop.replace(/([A-Z])/g, "-$1").toLowerCase(),
    );
  }

  const isInput = element instanceof HTMLInputElement;

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  // Inputs never wrap; textareas wrap like pre-wrap.
  mirror.style.whiteSpace = isInput ? "pre" : "pre-wrap";
  mirror.style.wordWrap = isInput ? "normal" : "break-word";
  mirror.style.overflow = "hidden";

  document.body.appendChild(mirror);

  mirror.textContent = element.value.substring(0, position);

  const marker = document.createElement("span");
  marker.textContent = "\u200b"; // zero-width space
  mirror.appendChild(marker);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();

  const coords = {
    top: markerRect.top - mirrorRect.top - element.scrollTop,
    left: markerRect.left - mirrorRect.left - element.scrollLeft,
  };

  document.body.removeChild(mirror);
  return coords;
}
