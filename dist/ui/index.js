// src/ui/index.tsx
import { useState, useEffect } from "react";
import { usePluginData, usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";
import { jsx, jsxs } from "react/jsx-runtime";
function SettingsPage() {
  const context = useHostContext();
  const companyId = context?.companyId ?? "";
  const { data: projects, loading: projectsLoading } = usePluginData(
    "projects",
    { companyId }
  );
  const { data: syncStatus, loading: statusLoading, refresh: refreshStatus } = usePluginData("sync-status", {});
  const saveProject = usePluginAction("save-project");
  const [selectedProject, setSelectedProject] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (syncStatus?.projectId) {
      setSelectedProject(syncStatus.projectId);
    }
  }, [syncStatus?.projectId]);
  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await saveProject({ projectId: selectedProject || null });
      setMessage("Saved!");
      refreshStatus();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };
  const projectName = projects?.find((p) => p.id === syncStatus?.projectId)?.name;
  return /* @__PURE__ */ jsxs("div", { style: { maxWidth: 480, padding: 16 }, children: [
    /* @__PURE__ */ jsx("h3", { style: { margin: "0 0 16px" }, children: "Todone.fyi Sync Settings" }),
    /* @__PURE__ */ jsxs("div", { style: { marginBottom: 16 }, children: [
      /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: "#666", marginBottom: 4 }, children: "Status" }),
      statusLoading ? /* @__PURE__ */ jsx("div", { children: "Loading..." }) : /* @__PURE__ */ jsxs("div", { style: { fontSize: 13 }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          "API Key: ",
          syncStatus?.hasApiKey ? "\u2713 configured" : "\u2717 not set"
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          "Last sync: ",
          syncStatus?.lastFullSync ? new Date(syncStatus.lastFullSync).toLocaleString() : "never"
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          "Synced tasks: ",
          syncStatus?.totalSynced ?? 0
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { marginBottom: 16 }, children: [
      /* @__PURE__ */ jsx(
        "label",
        {
          htmlFor: "project-select",
          style: { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 },
          children: "Paperclip Project"
        }
      ),
      /* @__PURE__ */ jsxs(
        "select",
        {
          id: "project-select",
          value: selectedProject,
          onChange: (e) => setSelectedProject(e.target.value),
          disabled: projectsLoading,
          style: {
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            borderRadius: 4,
            border: "1px solid #ccc"
          },
          children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "All projects" }),
            (projects ?? []).map((p) => /* @__PURE__ */ jsxs("option", { value: p.id, children: [
              p.name,
              " (",
              p.id.substring(0, 8),
              "\u2026)"
            ] }, p.id))
          ]
        }
      ),
      /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: "#888", marginTop: 4 }, children: 'Select which project to sync to Todone.fyi, or leave as "All projects" to sync everything.' })
    ] }),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: handleSave,
        disabled: saving,
        style: {
          padding: "6px 16px",
          fontSize: 13,
          borderRadius: 4,
          border: "1px solid #ccc",
          cursor: saving ? "wait" : "pointer"
        },
        children: saving ? "Saving\u2026" : "Save"
      }
    ),
    message && /* @__PURE__ */ jsx("span", { style: { marginLeft: 8, fontSize: 13, color: message.startsWith("Error") ? "red" : "green" }, children: message })
  ] });
}
export {
  SettingsPage
};
