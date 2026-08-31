export const THEMES = [
  { id: "vellum", label: "Vellum" },
  { id: "stacks", label: "Night stacks" },
  { id: "carbon", label: "Carbon" },
  { id: "folio", label: "Folio" },
  { id: "slate", label: "Slate press" },
  { id: "cyanotype", label: "Cyanotype" },
  { id: "indenture", label: "Indenture" },
  { id: "enamel", label: "Enamel" },
  { id: "safelight", label: "Safelight" },
  { id: "crate", label: "Crate" },
];

const STORAGE_KEY = "skill-cabinet-theme";
const IDS = new Set(THEMES.map((t) => t.id));

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && IDS.has(value)) return value;
  } catch {
    /* private mode */
  }
  return "carbon";
}

export function writeStoredTheme(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
}

export function applyTheme(id) {
  const next = IDS.has(id) ? id : "carbon";
  document.documentElement.dataset.theme = next;
  return next;
}
