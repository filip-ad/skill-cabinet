export function deleteEffect(skill) {
  if (skill.link) {
    return {
      action: "unlink",
      label: "Unlink",
      path: skill.path,
      note: skill.linkTarget
        ? `Target ${skill.linkTarget} stays`
        : "The target stays",
    };
  }
  if (skill.file) {
    return {
      action: "delete-file",
      label: "Delete file",
      path: skill.path,
      note: "",
    };
  }
  return {
    action: "delete-folder",
    label: "Delete folder",
    path: skill.path,
    note: "",
  };
}
