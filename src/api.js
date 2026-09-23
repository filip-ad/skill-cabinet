const headers = { Accept: "application/json" };

async function json(url) {
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

export function fetchCatalog() {
  return json("/api/catalog");
}

export function fetchUsage() {
  return json("/api/usage");
}

export function fetchHealth() {
  return json("/api/health");
}

export function fetchSkill(id) {
  return json(`/api/skills/${encodeURIComponent(id)}`);
}

export function fetchSkillFile(id, relativePath) {
  const query = new URLSearchParams({ path: relativePath });
  return json(`/api/skills/${encodeURIComponent(id)}/file?${query}`);
}
