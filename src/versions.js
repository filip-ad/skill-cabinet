const SHORT_ID_LENGTH = 8;

function shortId(value) {
  return value.slice(0, SHORT_ID_LENGTH);
}

export function describeRevision(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "not recorded") {
    return { label: "Not recorded", note: "No version evidence", raw };
  }

  const codexInstalled = raw.match(/^codex:([^;]+)(?:;\s*sha256:([a-f0-9]+))?$/i);
  if (codexInstalled) {
    return {
      label: `Codex ${codexInstalled[1]}`,
      note: codexInstalled[2] ? `Content ${shortId(codexInstalled[2])}` : "Bundled release",
      raw,
    };
  }

  const codexLatest = raw.match(/^npm:@openai\/codex@(.+)$/i);
  if (codexLatest) {
    return { label: `Codex ${codexLatest[1]}`, note: "Bundled release", raw };
  }

  const revisionAndTree = raw.match(/^([a-f0-9]{40}):([a-f0-9]{40})$/i);
  if (revisionAndTree) {
    return {
      label: `Tree ${shortId(revisionAndTree[2])}`,
      note: `Revision ${shortId(revisionAndTree[1])}`,
      raw,
    };
  }

  const content = raw.match(/^(?:canonical-)?sha256:([a-f0-9]+)$/i);
  if (content) {
    return { label: `Content ${shortId(content[1])}`, note: "Exact content fingerprint", raw };
  }

  const tree = raw.match(/^git-tree:([a-f0-9]+)$/i);
  if (tree) {
    return { label: `Tree ${shortId(tree[1])}`, note: "Exact Git tree", raw };
  }

  const revision = raw.match(/^([a-f0-9]{40})$/i);
  if (revision) {
    return { label: `Revision ${shortId(revision[1])}`, note: "Repository revision", raw };
  }

  return { label: raw, note: "Source version", raw };
}
