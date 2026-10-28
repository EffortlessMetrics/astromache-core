// XML 1.0 Char: https://www.w3.org/TR/xml/#charsets
export function xml(text: string, context = "XML text"): string {
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (
      point === 0x9 ||
      point === 0xa ||
      point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff)
    )
      continue;
    throw new Error(
      `${context} contains a character forbidden by XML 1.0: U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
    );
  }
  return text.replace(
    /[<>&"'\r]/g,
    (ch) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;", "\r": "&#13;" })[
        ch
      ]!,
  );
}
