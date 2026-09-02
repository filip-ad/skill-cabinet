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

export const FORM_FILTERS = [
  { id: "all", label: "All" },
  { id: "physical", label: "Physical" },
  { id: "references", label: "References" },
  { id: "broken", label: "Broken" },
];

const FORM_KEY = "skill-cabinet-form";
const LEGACY_LINK_KEY = "skill-cabinet-links";
const FORM_IDS = new Set(FORM_FILTERS.map((t) => t.id));
const LEGACY_LINK = { hide: "physical", only: "references" };

export function readStoredFormFilter() {
  try {
    const value = localStorage.getItem(FORM_KEY);
    if (value && FORM_IDS.has(value)) return value;
    const legacy = localStorage.getItem(LEGACY_LINK_KEY);
    if (legacy && FORM_IDS.has(legacy)) return legacy;
    if (legacy && LEGACY_LINK[legacy]) return LEGACY_LINK[legacy];
  } catch {
    /* private mode */
  }
  return "all";
}

export function writeStoredFormFilter(id) {
  try {
    localStorage.setItem(FORM_KEY, id);
  } catch {
    /* private mode */
  }
}

export function matchesFormFilter(skill, filter) {
  if (filter === "physical") return skill.physicality === "physical";
  if (filter === "references") return skill.physicality === "reference";
  if (filter === "broken") return skill.physicality === "broken";
  return true;
}

export const RISK_FILTERS = [
  { id: "all", label: "All" },
  { id: "elevated", label: "Elevated" },
  { id: "hide", label: "Hide" },
];

const RISK_KEY = "skill-cabinet-risk";
const RISK_IDS = new Set(RISK_FILTERS.map((t) => t.id));
const ELEVATED_RISK = new Set(["high", "critical"]);

export function isElevatedRisk(risk) {
  return ELEVATED_RISK.has(risk);
}

export function readStoredRiskFilter() {
  try {
    const value = localStorage.getItem(RISK_KEY);
    if (value && RISK_IDS.has(value)) return value;
  } catch {
    /* private mode */
  }
  return "all";
}

export function writeStoredRiskFilter(id) {
  try {
    localStorage.setItem(RISK_KEY, id);
  } catch {
    /* private mode */
  }
}

export function matchesRiskFilter(skill, filter) {
  const elevated = isElevatedRisk(skill.risk);
  if (filter === "elevated") return elevated;
  if (filter === "hide") return !elevated;
  return true;
}

export const INVOCATION_FILTERS = [
  { id: "all", label: "All" },
  { id: "user", label: "User only" },
  { id: "model", label: "Model" },
  { id: "hook", label: "Hook" },
  { id: "off", label: "Off" },
];

const INVOCATION_KEY = "skill-cabinet-invocation";
const INVOCATION_KEY_LEGACY = "skill-cabinet-when";
const INVOCATION_IDS = new Set(INVOCATION_FILTERS.map((t) => t.id));

export function readStoredInvocationFilter() {
  try {
    const stored =
      localStorage.getItem(INVOCATION_KEY) ||
      localStorage.getItem(INVOCATION_KEY_LEGACY);
    if (stored && INVOCATION_IDS.has(stored)) return stored;
  } catch {
    /* private mode */
  }
  return "all";
}

export function writeStoredInvocationFilter(id) {
  try {
    localStorage.setItem(INVOCATION_KEY, id);
  } catch {
    /* private mode */
  }
}

export function matchesInvocationFilter(skill, filter) {
  if (filter === "all") return true;
  return (skill.invocation || "model") === filter;
}
