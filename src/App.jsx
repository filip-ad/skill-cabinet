import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchCatalog, fetchHealth, fetchSkill, fetchSkillFile, fetchUsage } from "./api.js";
import { EMPTY_FILTERS, filterSkills, groupSkills } from "./filters.js";
import Logo from "./Logo.jsx";
import { describeRevision } from "./versions.js";


function shortDate(value) {
  if (!value) return "No observations";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Metric({ value, label, tone = "" }) {
  return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

const FILTER_HELP = {
  sourceMachine: "Shows installations published by the selected machine. It does not merge the same skill from other machines.",
  cli: "Shows installations for the selected CLI, plus shared and all-CLI installations. It excludes other CLI-specific and repository-only installations.",
  scope: "Shows installations with this exact scope. Global, canonical, and repository-local scopes stay separate.",
  repository: "Shows only repository-local installations registered to this exact repository. It does not add global skills that may also be usable there.",
  ownership: "Shows installations with this exact maintenance owner type, such as local, upstream-managed, or repo-owned.",
  governance: "Shows installations with this exact policy relationship to their approved source.",
  source: "Shows installations from this exact registry or upstream source. This is source origin, not source machine.",
  currency: "Shows installations with this exact content state compared with the approved latest version.",
  occurrence: "Shows installations with assigned use of this evidence type. Exact comes from tool calls. Inferred comes from a clear Codex announcement. No use means no assigned calls.",
  resolution: "Filters assigned usage. Resolved calls map to one installation. Ambiguous and unresolved calls have no installation row, so those choices can show no rows. Their totals remain at the top.",
  lastUse: "Shows installations with an assigned call inside this recent time period. Installations without a dated call are excluded.",
};

function Filter({ name, label, value, values, onChange, children }) {
  const inputId = `filter-${name}`;
  const helpId = `${inputId}-help`;
  return (
    <div className="filter">
      <div className="filter-title">
        <label htmlFor={inputId}>{label}</label>
        <button type="button" className="filter-help-button" popoverTarget={helpId} aria-label={`${label} filter help`}>?</button>
        <div id={helpId} className="filter-popover" popover="auto"><strong>{label}</strong><span>{FILTER_HELP[name]}</span></div>
      </div>
      <select id={inputId} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {children || values.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>
  );
}

function StatusPill({ value }) {
  const tone = value === "current" ? "good" : value === "update available" ? "warn" : "quiet";
  return <span className={`pill ${tone}`}>{value}</span>;
}

function SkillRow({ group, selected, onSelect }) {
  const skill = group.representative;
  const installationLabel = group.matching_installations === group.total_installations
    ? `${group.total_installations} ${group.total_installations === 1 ? "installation" : "installations"}`
    : `${group.matching_installations} of ${group.total_installations} installations`;
  return (
    <button className={`skill-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className="skill-mark">{skill.display_name.slice(0, 2).toUpperCase()}</span>
      <span className="skill-main">
        <strong>{skill.display_name}</strong>
        <small>{skill.description || skill.source}</small>
        <span className="tag-line"><span>{installationLabel}</span><span>{group.cli_summary}</span><span>{skill.ownership}</span></span>
      </span>
      <span className="skill-side">
        <StatusPill value={group.status} />
        <small>{group.invocations} calls</small>
      </span>
    </button>
  );
}

function VersionComparison({ currency, checkedAt }) {
  const installed = describeRevision(currency.installed);
  const latest = describeRevision(currency.latest);
  return (
    <section className="version-comparison" aria-label="Version comparison">
      <div className="version-heading">
        <div><strong>Current vs latest</strong><StatusPill value={currency.status} /></div>
        <span>Verified {shortDate(checkedAt)}</span>
      </div>
      <div className="version-grid">
        <div><span>Current on this machine</span><strong>{installed.label}</strong><small>{installed.note}</small></div>
        <div><span>Latest available</span><strong>{latest.label}</strong><small>{latest.note}</small></div>
      </div>
      <details className="revision-details">
        <summary>Technical IDs</summary>
        <dl>
          <div><dt>Installed</dt><dd>{installed.raw || "Not recorded"}</dd></div>
          <div><dt>Latest</dt><dd>{latest.raw || "Not recorded"}</dd></div>
        </dl>
      </details>
    </section>
  );
}

function Detail({ detail, loading, error, onFile, onInstallation, checkedAt }) {
  if (loading) return <aside className="detail empty">Loading skill…</aside>;
  if (error) return <aside className="detail empty error">{error}</aside>;
  if (!detail) return <aside className="detail empty">Select a skill.</aside>;
  const skill = detail.installation;
  return (
    <aside className="detail">
      <header className="detail-head">
        <div><span className="eyebrow">Governed skill</span><h2>{skill.display_name}</h2></div>
        <StatusPill value={skill.currency.status} />
      </header>
      <p className="description">{skill.description}</p>
      {detail.group_installations.length > 1 ? (
        <label className="installation-picker">
          <span>Installation</span>
          <select value={skill.installation_id} onChange={(event) => onInstallation(event.target.value)}>
            {detail.group_installations.map((row) => (
              <option key={row.installation_id} value={row.installation_id}>{row.cli} · {row.scope} · {row.location}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="detail-metrics">
        <Metric value={detail.usage.invocations || 0} label="selected install calls" />
        <Metric value={detail.usage.unique_sessions || 0} label="selected install sessions" />
      </div>
      <VersionComparison currency={skill.currency} checkedAt={checkedAt} />
      <dl className="facts">
        <div><dt>CLI</dt><dd>{skill.cli}</dd></div>
        <div><dt>Source machine</dt><dd>{skill.source_id || "This machine"}</dd></div>
        <div><dt>Snapshot</dt><dd>{skill.source_generated_at ? shortDate(skill.source_generated_at) : "Live local data"}</dd></div>
        <div><dt>Scope</dt><dd>{skill.scope}</dd></div>
        <div><dt>Owner</dt><dd>{skill.governance_owner || "Not assigned"}</dd></div>
        <div><dt>Governance</dt><dd>{skill.governance}</dd></div>
        <div><dt>Source</dt><dd className="path">{skill.source}</dd></div>
        <div><dt>Tracking issue</dt><dd className="path">{skill.tracking_issue || "None"}</dd></div>
        <div><dt>Last use</dt><dd>{shortDate(detail.usage.last_use)}</dd></div>
        <div><dt>Group installs</dt><dd>{detail.group_installations.length}</dd></div>
        <div><dt>Location</dt><dd className="path">{skill.location}</dd></div>
      </dl>
      {detail.usage.by_cli.length || detail.usage.by_repository.length ? (
        <div className="usage-splits">
          <div><strong>CLI split</strong><span>{detail.usage.by_cli.map((row) => `${row.key} ${row.invocations}`).join(" · ") || "None"}</span></div>
          <div><strong>Repository split</strong><span>{detail.usage.by_repository.map((row) => `${row.key} ${row.invocations}`).join(" · ") || "None"}</span></div>
        </div>
      ) : null}
      <div className="manuscript-tabs">
        <strong>Files</strong>
        <select value={detail.manuscript.path} onChange={(event) => onFile(event.target.value)}>
          {detail.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
        </select>
      </div>
      <article className="manuscript"><Markdown remarkPlugins={[remarkGfm]}>{detail.manuscript.content}</Markdown></article>
    </aside>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [usage, setUsage] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    Promise.all([fetchCatalog(), fetchUsage(), fetchHealth()])
      .then(([nextCatalog, nextUsage, nextHealth]) => {
        setCatalog(nextCatalog);
        setUsage(nextUsage);
        setHealth(nextHealth);
      })
      .catch((reason) => setError(reason.message));
  }, []);

  const usageBySkill = useMemo(
    () => new Map((usage?.by_skill || []).map((row) => [row.key, row])),
    [usage],
  );
  const matchingInstallations = useMemo(
    () => filterSkills(catalog?.skills || [], usageBySkill, query, filters),
    [catalog, usageBySkill, query, filters],
  );
  const visible = useMemo(
    () => groupSkills(catalog?.skills || [], matchingInstallations, usageBySkill),
    [catalog, matchingInstallations, usageBySkill],
  );

  useEffect(() => {
    if (!visible.length) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    if (!visible.some((group) => group.installations.some((row) => row.installation_id === selectedId))) {
      setSelectedId(visible[0].representative.installation_id);
    }
  }, [visible, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailLoading(true);
    setDetailError("");
    fetchSkill(selectedId)
      .then((value) => { if (active) setDetail(value); })
      .catch((reason) => { if (active) setDetailError(reason.message); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  async function selectFile(relativePath) {
    if (!detail) return;
    try {
      const manuscript = await fetchSkillFile(detail.installation.installation_id, relativePath);
      setDetail({ ...detail, manuscript });
    } catch (reason) {
      setDetailError(reason.message);
    }
  }

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const currentCount = catalog?.skills.filter((row) => row.currency.status === "current").length || 0;
  const unassigned = usage?.summary.unassigned_exact || 0;
  const dimensions = catalog?.dimensions || {};
  const activeFilterCount = Object.values(filters).filter((value) => value !== "all").length;
  const adapterErrors = (health?.adapter_health || []).reduce((total, row) => total + row.errors, 0);
  const staleSources = (health?.snapshot_sources || []).filter((row) => row.status === "stale").length;
  const sourceConflicts = health?.source_conflicts?.length || 0;

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand"><Logo /><div><span className="eyebrow">Private · governed · read-only</span><h1>Skills Cabinet</h1></div></div>
        <div className="freshness"><span className="live-dot" />Currency checked {shortDate(catalog?.currency_checked_at)}</div>
      </header>

      {error ? <div className="fatal">{error}</div> : null}
      <section className="metrics-bar">
        <Metric value={catalog?.counts.canonical_groups || "—"} label="unique skills" />
        <Metric value={catalog?.counts.installations || "—"} label="installations" />
        <Metric value={health?.snapshot_sources?.length || (catalog ? 1 : "—")} label="source machines" />
        <Metric value={usage?.summary.invocations || 0} label="observed calls" tone="accent" />
        <Metric value={currentCount} label="current installs" />
        <Metric value={unassigned} label="exact, unassigned" tone={unassigned ? "warn" : ""} />
      </section>

      <main className="workspace">
        <section className="catalog-panel">
          <div className="search-row">
            <label className="search"><span>Find</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, path, owner, source…" /></label>
            <button className="clear" onClick={() => { setQuery(""); setFilters(EMPTY_FILTERS); }}>Clear filters</button>
          </div>
          <details className="filter-drawer">
            <summary>
              <strong>Filters</strong>
              <span>{activeFilterCount ? `${activeFilterCount} active` : "All installations"}</span>
            </summary>
            <div className="filters">
              <Filter name="sourceMachine" label="Source machine" value={filters.sourceMachine} values={dimensions.source_machine || []} onChange={(value) => setFilter("sourceMachine", value)} />
              <Filter name="cli" label="CLI" value={filters.cli} values={dimensions.cli || []} onChange={(value) => setFilter("cli", value)} />
              <Filter name="scope" label="Scope" value={filters.scope} values={dimensions.scope || []} onChange={(value) => setFilter("scope", value)} />
              <Filter name="repository" label="Repository" value={filters.repository} values={dimensions.repository || []} onChange={(value) => setFilter("repository", value)} />
              <Filter name="ownership" label="Ownership" value={filters.ownership} values={dimensions.ownership || []} onChange={(value) => setFilter("ownership", value)} />
              <Filter name="governance" label="Governance" value={filters.governance} values={dimensions.governance || []} onChange={(value) => setFilter("governance", value)} />
              <Filter name="source" label="Source" value={filters.source} values={dimensions.source || []} onChange={(value) => setFilter("source", value)} />
              <Filter name="currency" label="Currency" value={filters.currency} values={dimensions.currency || []} onChange={(value) => setFilter("currency", value)} />
              <Filter name="occurrence" label="Occurrence" value={filters.occurrence} values={[]} onChange={(value) => setFilter("occurrence", value)}><option value="exact">Exact</option><option value="inferred">Inferred</option><option value="none">No use</option></Filter>
              <Filter name="resolution" label="Identity" value={filters.resolution} values={[]} onChange={(value) => setFilter("resolution", value)}><option value="resolved">Resolved</option><option value="ambiguous">Ambiguous</option><option value="unresolved">Unresolved</option><option value="none">No use</option></Filter>
              <Filter name="lastUse" label="Last use" value={filters.lastUse} values={[]} onChange={(value) => setFilter("lastUse", value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></Filter>
            </div>
          </details>
          <div className="list-heading"><strong>{visible.length}</strong> skills · {matchingInstallations.length} matching installations</div>
          <div className="skill-list">
            {visible.map((group) => <SkillRow key={group.group_id} group={group} selected={group.installations.some((row) => row.installation_id === selectedId)} onSelect={() => setSelectedId(group.representative.installation_id)} />)}
          </div>
          <footer className="evidence-note">
            <strong>Evidence boundary</strong>
            <span>Claude and Kimi structured calls are exact. Codex history is inferred. Antigravity history and recorder logs are not counted in v1.</span>
            <small>{health?.snapshot_sources?.length || 1} sources · {staleSources} stale · {sourceConflicts} conflicts · {adapterErrors} adapter errors</small>
          </footer>
        </section>
        <Detail detail={detail} loading={detailLoading} error={detailError} onFile={selectFile} onInstallation={setSelectedId} checkedAt={detail?.installation.currency_checked_at || catalog?.currency_checked_at} />
      </main>
    </div>
  );
}
