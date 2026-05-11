import { createRequire } from 'module'; const require = createRequire(import.meta.url);

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
export {
  TodoneApiError,
  TodoneClient
};
//# sourceMappingURL=todone-client.mjs.map
