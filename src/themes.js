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

export const LINK_FILTERS = [
  { id: "all", label: "All" },
  { id: "only", label: "Only" },
  { id: "hide", label: "Hide" },
];

const LINK_KEY = "skill-cabinet-links";
const LINK_IDS = new Set(LINK_FILTERS.map((t) => t.id));

export function readStoredLinkFilter() {
  try {
    const value = localStorage.getItem(LINK_KEY);
    if (value && LINK_IDS.has(value)) return value;
  } catch {
    /* private mode */
  }
  return "all";
}

export function writeStoredLinkFilter(id) {
  try {
    localStorage.setItem(LINK_KEY, id);
  } catch {
    /* private mode */
  }
}

export function matchesLinkFilter(skill, filter) {
  if (filter === "only") return Boolean(skill.link);
  if (filter === "hide") return !skill.link;
  return true;
}
