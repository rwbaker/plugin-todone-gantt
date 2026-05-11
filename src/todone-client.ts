export interface TodoneTask {
  id: string;
  title: string;
  body?: string;
  priority?: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  dueDate?: string;
  scheduledDate?: string;
  startDate?: string;
  duration?: number;
  categoryId?: string;
  stageId?: string;
  dependsOnIds?: string[];
  position?: number;
  completedAt?: string | null;
}

export interface TodoneTaskCreate {
  title: string;
  body?: string;
  priority?: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  dueDate?: string;
  scheduledDate?: string;
  startDate?: string;
  duration?: number;
  categoryId?: string;
  dependsOnIds?: string[];
  force?: boolean;
}

export interface TodoneTaskUpdate {
  title?: string;
  body?: string;
  priority?: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  dueDate?: string | null;
  scheduledDate?: string | null;
  startDate?: string | null;
  duration?: number | null;
  categoryId?: string | null;
  stageId?: string;
  dependsOnIds?: string[];
}

export interface TodoneStage {
  id: string;
  name: string;
  position: number;
  isComplete?: boolean;
}

export interface TodoneCategory {
  id: string;
  name: string;
}

export interface TodoneWorkspace {
  id: string;
  name: string;
}

export interface TodoneBatchResult {
  created: TodoneTask[];
  errors?: Array<{ index: number; error: string }>;
}

export class TodoneApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public existingId?: string,
    public similarTasks?: Array<{ id: string; title: string; score: number }>,
  ) {
    super(message);
    this.name = 'TodoneApiError';
  }
}

export class TodoneClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { baseUrl: string; apiKey: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!res.ok) {
      let body: Record<string, unknown> = {};
      try {
        body = await res.json() as Record<string, unknown>;
      } catch {}

      if (res.status === 409) {
        throw new TodoneApiError(
          409,
          (body.message as string) || 'Duplicate task',
          body.existingId as string | undefined,
          body.similarTasks as TodoneApiError['similarTasks'],
        );
      }

      throw new TodoneApiError(
        res.status,
        (body.message as string) || `Todone API error: ${res.status} ${res.statusText}`,
      );
    }

    return res.json() as Promise<T>;
  }

  async listWorkspaces(): Promise<TodoneWorkspace[]> {
    return this.request('/api/workspaces');
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    await this.request(`/api/workspaces/${workspaceId}/switch`, { method: 'POST' });
  }

  async listStages(): Promise<TodoneStage[]> {
    return this.request('/api/stages');
  }

  async createStage(name: string): Promise<TodoneStage> {
    return this.request('/api/stages', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async listCategories(): Promise<TodoneCategory[]> {
    return this.request('/api/categories');
  }

  async createCategory(name: string): Promise<TodoneCategory> {
    return this.request('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async createTask(task: TodoneTaskCreate): Promise<TodoneTask> {
    return this.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  async updateTask(taskId: string, patch: TodoneTaskUpdate): Promise<TodoneTask> {
    return this.request(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(`/api/tasks/${taskId}`, { method: 'DELETE' });
  }

  async listTasks(params?: {
    stage?: string;
    priority?: string;
    category?: string;
    sort?: string;
  }): Promise<TodoneTask[]> {
    const qs = new URLSearchParams();
    if (params?.stage) qs.set('stage', params.stage);
    if (params?.priority) qs.set('priority', params.priority);
    if (params?.category) qs.set('category', params.category);
    if (params?.sort) qs.set('sort', params.sort);
    const query = qs.toString();
    return this.request(`/api/tasks${query ? `?${query}` : ''}`);
  }

  async batchCreateTasks(tasks: TodoneTaskCreate[]): Promise<TodoneBatchResult> {
    return this.request('/api/tasks/batch', {
      method: 'POST',
      body: JSON.stringify({ tasks }),
    });
  }
}
