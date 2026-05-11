import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// src/worker.ts
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

// src/todone-client.ts
var TodoneApiError = class extends Error {
  constructor(statusCode, message, existingId, similarTasks) {
    super(message);
    this.statusCode = statusCode;
    this.existingId = existingId;
    this.similarTasks = similarTasks;
    this.name = "TodoneApiError";
  }
  statusCode;
  existingId;
  similarTasks;
};
var TodoneClient = class {
  baseUrl;
  apiKey;
  constructor(opts) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }
  async request(path, init) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers
      }
    });
    if (!res.ok) {
      let body = {};
      try {
        body = await res.json();
      } catch {
      }
      if (res.status === 409) {
        throw new TodoneApiError(
          409,
          body.message || "Duplicate task",
          body.existingId,
          body.similarTasks
        );
      }
      throw new TodoneApiError(
        res.status,
        body.message || `Todone API error: ${res.status} ${res.statusText}`
      );
    }
    return res.json();
  }
  async listWorkspaces() {
    return this.request("/api/workspaces");
  }
  async switchWorkspace(workspaceId) {
    await this.request(`/api/workspaces/${workspaceId}/switch`, { method: "POST" });
  }
  async listStages() {
    return this.request("/api/stages");
  }
  async createStage(name) {
    return this.request("/api/stages", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }
  async listCategories() {
    return this.request("/api/categories");
  }
  async createCategory(name) {
    return this.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }
  async createTask(task) {
    return this.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify(task)
    });
  }
  async updateTask(taskId, patch) {
    return this.request(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }
  async deleteTask(taskId) {
    await this.request(`/api/tasks/${taskId}`, { method: "DELETE" });
  }
  async listTasks(params) {
    const qs = new URLSearchParams();
    if (params?.stage) qs.set("stage", params.stage);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.category) qs.set("category", params.category);
    if (params?.sort) qs.set("sort", params.sort);
    const query = qs.toString();
    return this.request(`/api/tasks${query ? `?${query}` : ""}`);
  }
  async batchCreateTasks(tasks) {
    return this.request("/api/tasks/batch", {
      method: "POST",
      body: JSON.stringify({ tasks })
    });
  }
};

// src/worker.ts
var STATUS_STAGE_MAP = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled"
};
var PRIORITY_MAP = {
  critical: "URGENT",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW"
};
function stateKey(issueId) {
  return `mapping:${issueId}`;
}
function buildClient(config) {
  return new TodoneClient({
    baseUrl: config.todoneBaseUrl || "https://www.todone.fyi",
    apiKey: config.todoneApiKey
  });
}
function hasCredentials(config) {
  return !!config.todoneApiKey;
}
var plugin = definePlugin({
  async setup(ctx) {
    async function ensureStages(client) {
      const existing = await client.listStages();
      const stageMap = /* @__PURE__ */ new Map();
      for (const s of existing) stageMap.set(s.name, s.id);
      for (const stageName of Object.values(STATUS_STAGE_MAP)) {
        if (!stageMap.has(stageName)) {
          const created = await client.createStage(stageName);
          stageMap.set(created.name, created.id);
        }
      }
      return stageMap;
    }
    async function ensureCategory(client, name) {
      const existing = await client.listCategories();
      const found = existing.find((c) => c.name === name);
      if (found) return found.id;
      const created = await client.createCategory(name);
      return created.id;
    }
    async function getMapping(issueId) {
      const data = await ctx.state.get({
        scopeKind: "issue",
        scopeId: issueId,
        stateKey: stateKey(issueId)
      });
      return data ?? null;
    }
    async function setMapping(mapping) {
      await ctx.state.set(
        {
          scopeKind: "issue",
          scopeId: mapping.paperclipIssueId,
          stateKey: stateKey(mapping.paperclipIssueId)
        },
        mapping
      );
    }
    async function getSyncState() {
      const data = await ctx.state.get({
        scopeKind: "instance",
        stateKey: "sync-state"
      });
      return data ?? { lastFullSync: null, totalSynced: 0 };
    }
    async function setSyncState(state) {
      await ctx.state.set(
        { scopeKind: "instance", stateKey: "sync-state" },
        state
      );
    }
    async function syncIssueToTodone(client, issue, stageMap, categoryId, dryRun, defaultDuration, allMappings) {
      const existing = await getMapping(issue.id);
      const stageName = STATUS_STAGE_MAP[issue.status] || "To Do";
      const stageId = stageMap.get(stageName);
      const todonePriority = PRIORITY_MAP[issue.priority] || "MEDIUM";
      const dependsOnIds = [];
      if (issue.parentId && allMappings.has(issue.parentId)) {
        dependsOnIds.push(allMappings.get(issue.parentId));
      }
      if (existing) {
        if (dryRun) {
          ctx.logger.info(`[DRY RUN] Would update Todone task ${existing.todoneTaskId} for ${issue.identifier || issue.id}`);
          return { action: "skipped" };
        }
        try {
          await client.updateTask(existing.todoneTaskId, {
            title: issue.title,
            body: issue.description?.substring(0, 5e4),
            priority: todonePriority,
            stageId,
            duration: defaultDuration,
            dependsOnIds: dependsOnIds.length > 0 ? dependsOnIds : void 0
          });
          await setMapping({
            ...existing,
            lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          return { action: "updated", todoneTaskId: existing.todoneTaskId };
        } catch (err) {
          if (err instanceof TodoneApiError && err.statusCode === 404) {
            ctx.logger.warn(`Todone task ${existing.todoneTaskId} not found, will re-create`);
          } else {
            throw err;
          }
        }
      }
      if (dryRun) {
        ctx.logger.info(`[DRY RUN] Would create Todone task for ${issue.identifier || issue.id}: "${issue.title}"`);
        return { action: "skipped" };
      }
      try {
        const created = await client.createTask({
          title: issue.title,
          body: issue.description?.substring(0, 5e4),
          priority: todonePriority,
          duration: defaultDuration,
          dependsOnIds: dependsOnIds.length > 0 ? dependsOnIds : void 0,
          force: true
        });
        if (stageId) {
          await client.updateTask(created.id, { stageId });
        }
        await setMapping({
          paperclipIssueId: issue.id,
          todoneTaskId: created.id,
          lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
          issueIdentifier: issue.identifier
        });
        return { action: "created", todoneTaskId: created.id };
      } catch (err) {
        if (err instanceof TodoneApiError && err.statusCode === 409 && err.existingId) {
          await setMapping({
            paperclipIssueId: issue.id,
            todoneTaskId: err.existingId,
            lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
            issueIdentifier: issue.identifier
          });
          return { action: "updated", todoneTaskId: err.existingId };
        }
        throw err;
      }
    }
    async function fullProjectSync(companyId, projectId, config) {
      const client = buildClient(config);
      const dryRun = !!config.dryRun;
      const defaultDuration = config.defaultDurationMinutes || 60;
      const stageMap = await ensureStages(client);
      const categoryId = await ensureCategory(client, "Paperclip");
      const issues = await ctx.issues.list({
        companyId,
        projectId,
        limit: 200
      });
      ctx.logger.info(`Found ${issues.length} issues to sync`, { companyId, projectId });
      const allMappings = /* @__PURE__ */ new Map();
      for (const issue of issues) {
        const m = await getMapping(issue.id);
        if (m) allMappings.set(issue.id, m.todoneTaskId);
      }
      const results = { created: 0, updated: 0, skipped: 0, errors: [] };
      const parentIssues = issues.filter((i) => !i.parentId);
      const childIssues = issues.filter((i) => i.parentId);
      for (const issue of parentIssues) {
        try {
          const result = await syncIssueToTodone(
            client,
            issue,
            stageMap,
            categoryId,
            dryRun,
            defaultDuration,
            allMappings
          );
          results[result.action]++;
          if (result.todoneTaskId) allMappings.set(issue.id, result.todoneTaskId);
        } catch (err) {
          results.errors.push(`${issue.identifier || issue.id}: ${err.message}`);
          ctx.logger.error(`Failed to sync ${issue.identifier || issue.id}`, { error: err.message });
        }
      }
      for (const issue of childIssues) {
        try {
          const result = await syncIssueToTodone(
            client,
            issue,
            stageMap,
            categoryId,
            dryRun,
            defaultDuration,
            allMappings
          );
          results[result.action]++;
          if (result.todoneTaskId) allMappings.set(issue.id, result.todoneTaskId);
        } catch (err) {
          results.errors.push(`${issue.identifier || issue.id}: ${err.message}`);
          ctx.logger.error(`Failed to sync ${issue.identifier || issue.id}`, { error: err.message });
        }
      }
      const syncState = {
        lastFullSync: (/* @__PURE__ */ new Date()).toISOString(),
        totalSynced: results.created + results.updated
      };
      await setSyncState(syncState);
      return results;
    }
    ctx.events.on("issue.updated", async (event) => {
      const config = await ctx.config.get();
      if (!hasCredentials(config)) return;
      const payload = event.payload;
      const issueId = payload.id || payload.entityId || payload.issueId;
      if (!issueId) return;
      if (config.paperclipProjectId && payload.projectId !== config.paperclipProjectId) return;
      const issue = await ctx.issues.get(issueId, event.companyId);
      if (!issue) return;
      const existing = await getMapping(issueId);
      if (!existing) return;
      const client = buildClient(config);
      const stageMap = await ensureStages(client);
      const stageName = STATUS_STAGE_MAP[issue.status] || "To Do";
      const stageId = stageMap.get(stageName);
      const todonePriority = PRIORITY_MAP[issue.priority] || "MEDIUM";
      try {
        await client.updateTask(existing.todoneTaskId, {
          title: issue.title,
          body: issue.description?.substring(0, 5e4),
          priority: todonePriority,
          stageId
        });
        await setMapping({
          ...existing,
          lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        ctx.logger.info(`Synced update for ${issue.identifier || issueId}`);
      } catch (err) {
        ctx.logger.error(`Failed to sync update for ${issue.identifier || issueId}`, {
          error: err.message
        });
      }
    });
    ctx.data.register("sync-status", async () => {
      const config = await ctx.config.get();
      const syncState = await getSyncState();
      return {
        hasApiKey: !!config.todoneApiKey,
        projectId: config.paperclipProjectId || null,
        dryRun: !!config.dryRun,
        ...syncState
      };
    });
    ctx.data.register("projects", async (params) => {
      const companyId = params.companyId;
      if (!companyId) return [];
      const projects = await ctx.projects.list({ companyId, limit: 100 });
      return projects.map((p) => ({ id: p.id, name: p.name }));
    });
    ctx.actions.register("save-project", async (params) => {
      const projectId = params.projectId;
      const config = await ctx.config.get();
      config.paperclipProjectId = projectId || "";
      return { saved: true, projectId };
    });
    ctx.jobs.register("reconcile-sync", async (job) => {
      const config = await ctx.config.get();
      ctx.logger.info("Reconcile sync job triggered", { runId: job.runId, trigger: job.trigger });
      if (!hasCredentials(config)) {
        ctx.logger.warn("Todone.fyi API key not configured \u2014 skipping reconcile");
        return;
      }
      const companies = await ctx.companies.list();
      if (companies.length === 0) {
        ctx.logger.warn("No companies found");
        return;
      }
      const companyId = companies[0].id;
      const projectId = config.paperclipProjectId;
      const results = await fullProjectSync(companyId, projectId, config);
      ctx.logger.info("Reconcile complete", results);
      if (results.errors.length > 0) {
        throw new Error(`${results.errors.length} sync error(s): ${results.errors.join("; ")}`);
      }
    });
    ctx.tools.register(
      "sync-project",
      {
        displayName: "Sync Project to Todone.fyi",
        description: "Syncs all issues from a Paperclip project to Todone.fyi for Gantt chart visualization. Creates tasks with dependencies mapped from issue parent/blocker relationships.",
        parametersSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Paperclip project ID to sync. If omitted, uses the configured default."
            }
          }
        }
      },
      async (params, runCtx) => {
        const config = await ctx.config.get();
        if (!hasCredentials(config)) {
          return { error: "Todone.fyi API key not configured. Set it in plugin settings." };
        }
        const p = params;
        const projectId = p.projectId || config.paperclipProjectId || runCtx.projectId;
        try {
          const results = await fullProjectSync(runCtx.companyId, projectId, config);
          const summary = [
            `Sync complete for project ${projectId || "(all)"}:`,
            `- Created: ${results.created}`,
            `- Updated: ${results.updated}`,
            `- Skipped: ${results.skipped}`,
            results.errors.length > 0 ? `- Errors: ${results.errors.length} (${results.errors.slice(0, 3).join("; ")})` : "- Errors: 0"
          ].join("\n");
          return { content: summary, data: results };
        } catch (err) {
          return { error: `Sync failed: ${err.message}` };
        }
      }
    );
    ctx.tools.register(
      "get-sync-status",
      {
        displayName: "Get Todone Sync Status",
        description: "Returns the current sync state: how many issues are synced, last sync time, and configuration status.",
        parametersSchema: {
          type: "object",
          properties: {}
        }
      },
      async () => {
        const config = await ctx.config.get();
        const syncState = await getSyncState();
        const status = {
          configured: hasCredentials(config),
          projectId: config.paperclipProjectId || null,
          dryRun: !!config.dryRun,
          lastFullSync: syncState.lastFullSync,
          totalSynced: syncState.totalSynced
        };
        const lines = [
          `Todone.fyi Sync Status:`,
          `- API Key: ${status.configured ? "configured" : "NOT SET"}`,
          `- Project filter: ${status.projectId || "all projects"}`,
          `- Dry run: ${status.dryRun}`,
          `- Last full sync: ${status.lastFullSync || "never"}`,
          `- Total synced: ${status.totalSynced}`
        ];
        return { content: lines.join("\n"), data: status };
      }
    );
  },
  async onHealth() {
    return { status: "ok", message: "Todone.fyi Sync plugin running" };
  },
  async onValidateConfig(config) {
    const errors = [];
    const warnings = [];
    if (!config.todoneApiKey) {
      errors.push("Todone.fyi API Key is required");
    } else if (typeof config.todoneApiKey === "string" && !config.todoneApiKey.startsWith("td_")) {
      warnings.push("API Key does not start with td_ \u2014 verify it is correct");
    }
    if (config.dryRun) {
      warnings.push("Dry run mode is enabled \u2014 no changes will be made in Todone.fyi");
    }
    return { ok: errors.length === 0, errors, warnings };
  }
});
var worker_default = plugin;
runWorker(plugin, import.meta.url);
export {
  worker_default as default
};
//# sourceMappingURL=worker.mjs.map
