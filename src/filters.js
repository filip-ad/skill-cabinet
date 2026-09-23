export const EMPTY_FILTERS = {
  sourceMachine: "all",
  cli: "all",
  scope: "all",
  repository: "all",
  ownership: "all",
  governance: "all",
  source: "all",
  currency: "all",
  occurrence: "all",
  resolution: "all",
  lastUse: "all",
};

function matchesValue(value, selected) {
  return selected === "all" || value === selected;
}

function matchesCli(value, selected) {
  return selected === "all" || value === selected || value === "shared" || value === "all";
}

export function filterSkills(skills, usageBySkill, query, filters, now = Date.now()) {
  const needle = query.trim().toLowerCase();
  return skills.filter((skill) => {
    const use = usageBySkill.get(skill.installation_id);
    const haystack = [
      skill.display_name,
      skill.description,
      skill.location,
      skill.cli,
      skill.scope,
      skill.repository,
      skill.ownership,
      skill.governance,
      skill.source,
      skill.source_id,
    ].join("\n").toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (!matchesValue(skill.source_id, filters.sourceMachine)) return false;
    if (!matchesCli(skill.cli, filters.cli)) return false;
    if (!matchesValue(skill.scope, filters.scope)) return false;
    if (!matchesValue(skill.repository, filters.repository)) return false;
    if (!matchesValue(skill.ownership, filters.ownership)) return false;
    if (!matchesValue(skill.governance, filters.governance)) return false;
    if (!matchesValue(skill.source, filters.source)) return false;
    if (!matchesValue(skill.currency.status, filters.currency)) return false;
    if (filters.occurrence !== "all" && !(use?.occurrence_evidence || "none").split(",").includes(filters.occurrence)) return false;
    if (filters.resolution !== "all" && (use?.identity_resolution || "none") !== filters.resolution) return false;
    if (filters.lastUse !== "all") {
      if (!use?.last_use) return false;
      const ageDays = (now - new Date(use.last_use).valueOf()) / 86_400_000;
      if (ageDays > Number(filters.lastUse)) return false;
    }
    return true;
  });
}

const STATUS_PRIORITY = new Map([
  ["current", 0],
  ["intentionally pinned", 1],
  ["update available", 2],
  ["locally diverged", 3],
  ["unverifiable", 4],
]);

function groupId(skill) {
  return skill.canonical_group_id || skill.skill_id || skill.display_name;
}

function mostImportantStatus(installations) {
  return installations.reduce((current, installation) => {
    const status = installation.currency.status;
    return (STATUS_PRIORITY.get(status) ?? 5) > (STATUS_PRIORITY.get(current) ?? -1) ? status : current;
  }, "current");
}

export function groupSkills(allSkills, matchingSkills, usageBySkill) {
  const totalByGroup = new Map();
  for (const skill of allSkills) {
    const key = groupId(skill);
    totalByGroup.set(key, (totalByGroup.get(key) || 0) + 1);
  }

  const groups = new Map();
  for (const skill of matchingSkills) {
    const key = groupId(skill);
    if (!groups.has(key)) groups.set(key, { group_id: key, installations: [] });
    groups.get(key).installations.push(skill);
  }

  return [...groups.values()].map((group) => {
    const runtimeInstallations = group.installations.filter((row) => row.scope !== "canonical");
    const representativePool = runtimeInstallations.length ? runtimeInstallations : group.installations;
    const representative = representativePool.reduce((best, row) => {
      const bestCalls = Number(usageBySkill.get(best.installation_id)?.invocations || 0);
      const rowCalls = Number(usageBySkill.get(row.installation_id)?.invocations || 0);
      return rowCalls > bestCalls ? row : best;
    });
    const invocations = group.installations.reduce(
      (total, row) => total + Number(usageBySkill.get(row.installation_id)?.invocations || 0),
      0,
    );
    const cliValues = [...new Set(group.installations.map((row) => row.cli))];
    return {
      ...group,
      representative,
      invocations,
      status: mostImportantStatus(group.installations),
      matching_installations: group.installations.length,
      total_installations: totalByGroup.get(group.group_id) || group.installations.length,
      cli_summary: cliValues.length === 1 ? cliValues[0] : `${cliValues.length} CLIs`,
    };
  });
}
