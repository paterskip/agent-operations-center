/**
 * Kopiowanie tekstu do schowka z fallbackiem.
 *
 * `navigator.clipboard` wymaga bezpiecznego kontekstu (HTTPS/localhost) i bywa
 * niedostępne w starszych przeglądarkach mobilnych — wtedy schodzimy do
 * ukrytego <textarea> + execCommand("copy").
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // spadamy do fallbacku poniżej
    }
  }

  if (typeof document === "undefined") return false;
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
