import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';
import { TodoneClient, TodoneApiError } from './todone-client.js';
import type { TodoneTaskCreate, TodoneStage, TodoneCategory } from './todone-client.js';

interface SyncMapping {
  paperclipIssueId: string;
  todoneTaskId: string;
  lastSyncedAt: string;
  issueIdentifier?: string;
}

interface SyncState {
  lastFullSync: string | null;
  totalSynced: number;
}

interface IssuePayload {
  id?: string;
  entityId?: string;
  issueId?: string;
  title?: string;
  status?: string;
  priority?: string;
  companyId?: string;
  projectId?: string;
}

const STATUS_STAGE_MAP: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

const PRIORITY_MAP: Record<string, 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW'> = {
  critical: 'URGENT',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

function stateKey(issueId: string): string {
  return `mapping:${issueId}`;
}

function buildClient(config: Record<string, unknown>): TodoneClient {
  return new TodoneClient({
    baseUrl: (config.todoneBaseUrl as string) || 'https://www.todone.fyi',
    apiKey: config.todoneApiKey as string,
  });
}

function hasCredentials(config: Record<string, unknown>): boolean {
  return !!(config.todoneApiKey);
}

const plugin = definePlugin({
  async setup(ctx) {
    // -- Helpers --

    async function ensureStages(
      client: TodoneClient,
    ): Promise<Map<string, string>> {
      const existing = await client.listStages();
      const stageMap = new Map<string, string>();
      for (const s of existing) stageMap.set(s.name, s.id);

      for (const stageName of Object.values(STATUS_STAGE_MAP)) {
        if (!stageMap.has(stageName)) {
          const created = await client.createStage(stageName);
          stageMap.set(created.name, created.id);
        }
      }
      return stageMap;
    }

    async function ensureCategory(
      client: TodoneClient,
      name: string,
    ): Promise<string> {
      const existing = await client.listCategories();
      const found = existing.find((c) => c.name === name);
      if (found) return found.id;
      const created = await client.createCategory(name);
      return created.id;
    }

    async function getMapping(issueId: string): Promise<SyncMapping | null> {
      const data = await ctx.state.get({
        scopeKind: 'issue',
        scopeId: issueId,
        stateKey: stateKey(issueId),
      });
      return (data as SyncMapping) ?? null;
    }

    async function setMapping(mapping: SyncMapping): Promise<void> {
      await ctx.state.set(
        {
          scopeKind: 'issue',
          scopeId: mapping.paperclipIssueId,
          stateKey: stateKey(mapping.paperclipIssueId),
        },
        mapping,
      );
    }

    async function getSyncState(): Promise<SyncState> {
      const data = await ctx.state.get({
        scopeKind: 'instance',
        stateKey: 'sync-state',
      });
      return (data as SyncState) ?? { lastFullSync: null, totalSynced: 0 };
    }

    async function setSyncState(state: SyncState): Promise<void> {
      await ctx.state.set(
        { scopeKind: 'instance', stateKey: 'sync-state' },
        state,
      );
    }

    async function syncIssueToTodone(
      client: TodoneClient,
      issue: { id: string; identifier?: string; title: string; description?: string; status: string; priority: string; parentId?: string | null },
      stageMap: Map<string, string>,
      categoryId: string | undefined,
      dryRun: boolean,
      defaultDuration: number,
      allMappings: Map<string, string>,
    ): Promise<{ action: 'created' | 'updated' | 'skipped'; todoneTaskId?: string }> {
      const existing = await getMapping(issue.id);
      const stageName = STATUS_STAGE_MAP[issue.status] || 'To Do';
      const stageId = stageMap.get(stageName);
      const todonePriority = PRIORITY_MAP[issue.priority] || 'MEDIUM';

      const dependsOnIds: string[] = [];
      if (issue.parentId && allMappings.has(issue.parentId)) {
        dependsOnIds.push(allMappings.get(issue.parentId)!);
      }

      if (existing) {
        if (dryRun) {
          ctx.logger.info(`[DRY RUN] Would update Todone task ${existing.todoneTaskId} for ${issue.identifier || issue.id}`);
          return { action: 'skipped' };
        }
        try {
          await client.updateTask(existing.todoneTaskId, {
            title: issue.title,
            body: issue.description?.substring(0, 50000),
            priority: todonePriority,
            stageId,
            duration: defaultDuration,
            dependsOnIds: dependsOnIds.length > 0 ? dependsOnIds : undefined,
          });
          await setMapping({
            ...existing,
            lastSyncedAt: new Date().toISOString(),
          });
          return { action: 'updated', todoneTaskId: existing.todoneTaskId };
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
        return { action: 'skipped' };
      }

      try {
        const created = await client.createTask({
          title: issue.title,
          body: issue.description?.substring(0, 50000),
          priority: todonePriority,
          duration: defaultDuration,
          dependsOnIds: dependsOnIds.length > 0 ? dependsOnIds : undefined,
          force: true,
        });

        if (stageId) {
          await client.updateTask(created.id, { stageId });
        }

        await setMapping({
          paperclipIssueId: issue.id,
          todoneTaskId: created.id,
          lastSyncedAt: new Date().toISOString(),
          issueIdentifier: issue.identifier,
        });

        return { action: 'created', todoneTaskId: created.id };
      } catch (err) {
        if (err instanceof TodoneApiError && err.statusCode === 409 && err.existingId) {
          await setMapping({
            paperclipIssueId: issue.id,
            todoneTaskId: err.existingId,
            lastSyncedAt: new Date().toISOString(),
            issueIdentifier: issue.identifier,
          });
          return { action: 'updated', todoneTaskId: err.existingId };
        }
        throw err;
      }
    }

    async function fullProjectSync(
      companyId: string,
      projectId: string | undefined,
      config: Record<string, unknown>,
    ): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
      const client = buildClient(config);
      const dryRun = !!config.dryRun;
      const defaultDuration = (config.defaultDurationMinutes as number) || 60;

      const stageMap = await ensureStages(client);
      const categoryId = await ensureCategory(client, 'Paperclip');

      const issues = await ctx.issues.list({
        companyId,
        projectId,
        limit: 200,
      });

      ctx.logger.info(`Found ${issues.length} issues to sync`, { companyId, projectId });

      const allMappings = new Map<string, string>();
      for (const issue of issues) {
        const m = await getMapping(issue.id);
        if (m) allMappings.set(issue.id, m.todoneTaskId);
      }

      const results = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

      const parentIssues = issues.filter((i) => !i.parentId);
      const childIssues = issues.filter((i) => i.parentId);

      for (const issue of parentIssues) {
        try {
          const result = await syncIssueToTodone(
            client, issue, stageMap, categoryId, dryRun, defaultDuration, allMappings,
          );
          results[result.action]++;
          if (result.todoneTaskId) allMappings.set(issue.id, result.todoneTaskId);
        } catch (err) {
          results.errors.push(`${issue.identifier || issue.id}: ${(err as Error).message}`);
          ctx.logger.error(`Failed to sync ${issue.identifier || issue.id}`, { error: (err as Error).message });
        }
      }

      for (const issue of childIssues) {
        try {
          const result = await syncIssueToTodone(
            client, issue, stageMap, categoryId, dryRun, defaultDuration, allMappings,
          );
          results[result.action]++;
          if (result.todoneTaskId) allMappings.set(issue.id, result.todoneTaskId);
        } catch (err) {
          results.errors.push(`${issue.identifier || issue.id}: ${(err as Error).message}`);
          ctx.logger.error(`Failed to sync ${issue.identifier || issue.id}`, { error: (err as Error).message });
        }
      }

      const syncState: SyncState = {
        lastFullSync: new Date().toISOString(),
        totalSynced: results.created + results.updated,
      };
      await setSyncState(syncState);

      return results;
    }

    // -- Event Handlers --

    ctx.events.on('issue.updated', async (event) => {
      const config = await ctx.config.get();
      if (!hasCredentials(config)) return;

      const payload = event.payload as IssuePayload;
      const issueId = payload.id || payload.entityId || payload.issueId;
      if (!issueId) return;

      if (config.paperclipProjectId && payload.projectId !== config.paperclipProjectId) return;

      const issue = await ctx.issues.get(issueId, event.companyId);
      if (!issue) return;

      const existing = await getMapping(issueId);
      if (!existing) return;

      const client = buildClient(config);

      const stageMap = await ensureStages(client);
      const stageName = STATUS_STAGE_MAP[issue.status] || 'To Do';
      const stageId = stageMap.get(stageName);
      const todonePriority = PRIORITY_MAP[issue.priority] || 'MEDIUM';

      try {
        await client.updateTask(existing.todoneTaskId, {
          title: issue.title,
          body: issue.description?.substring(0, 50000),
          priority: todonePriority,
          stageId,
        });
        await setMapping({
          ...existing,
          lastSyncedAt: new Date().toISOString(),
        });
        ctx.logger.info(`Synced update for ${issue.identifier || issueId}`);
      } catch (err) {
        ctx.logger.error(`Failed to sync update for ${issue.identifier || issueId}`, {
          error: (err as Error).message,
        });
      }
    });

    // -- Data Handlers --

    ctx.data.register('sync-status', async () => {
      const config = await ctx.config.get();
      const syncState = await getSyncState();
      return {
        hasApiKey: !!config.todoneApiKey,
        projectId: config.paperclipProjectId || null,
        dryRun: !!config.dryRun,
        ...syncState,
      };
    });

    ctx.data.register('projects', async (params) => {
      const companyId = params.companyId as string;
      if (!companyId) return [];
      const projects = await ctx.projects.list({ companyId, limit: 100 });
      return projects.map((p) => ({ id: p.id, name: p.name }));
    });

    // -- Action Handlers --

    ctx.actions.register('save-project', async (params) => {
      const projectId = params.projectId as string | null;
      const config = await ctx.config.get();
      config.paperclipProjectId = projectId || '';
      return { saved: true, projectId };
    });

    // -- Job Handlers --

    ctx.jobs.register('reconcile-sync', async (job) => {
      const config = await ctx.config.get();
      ctx.logger.info('Reconcile sync job triggered', { runId: job.runId, trigger: job.trigger });

      if (!hasCredentials(config)) {
        ctx.logger.warn('Todone.fyi API key not configured — skipping reconcile');
        return;
      }

      const companies = await ctx.companies.list();
      if (companies.length === 0) {
        ctx.logger.warn('No companies found');
        return;
      }

      const companyId = companies[0].id;
      const projectId = config.paperclipProjectId as string | undefined;

      const results = await fullProjectSync(companyId, projectId, config);

      ctx.logger.info('Reconcile complete', results);

      if (results.errors.length > 0) {
        throw new Error(`${results.errors.length} sync error(s): ${results.errors.join('; ')}`);
      }
    });

    // -- Agent Tools --

    ctx.tools.register(
      'sync-project',
      {
        displayName: 'Sync Project to Todone.fyi',
        description: 'Syncs all issues from a Paperclip project to Todone.fyi for Gantt chart visualization. Creates tasks with dependencies mapped from issue parent/blocker relationships.',
        parametersSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'Paperclip project ID to sync. If omitted, uses the configured default.',
            },
          },
        },
      },
      async (params, runCtx) => {
        const config = await ctx.config.get();

        if (!hasCredentials(config)) {
          return { error: 'Todone.fyi API key not configured. Set it in plugin settings.' };
        }

        const p = params as { projectId?: string };
        const projectId = p.projectId || (config.paperclipProjectId as string) || runCtx.projectId;

        try {
          const results = await fullProjectSync(runCtx.companyId, projectId, config);
          const summary = [
            `Sync complete for project ${projectId || '(all)'}:`,
            `- Created: ${results.created}`,
            `- Updated: ${results.updated}`,
            `- Skipped: ${results.skipped}`,
            results.errors.length > 0
              ? `- Errors: ${results.errors.length} (${results.errors.slice(0, 3).join('; ')})`
              : '- Errors: 0',
          ].join('\n');

          return { content: summary, data: results };
        } catch (err) {
          return { error: `Sync failed: ${(err as Error).message}` };
        }
      },
    );

    ctx.tools.register(
      'get-sync-status',
      {
        displayName: 'Get Todone Sync Status',
        description: 'Returns the current sync state: how many issues are synced, last sync time, and configuration status.',
        parametersSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        const config = await ctx.config.get();
        const syncState = await getSyncState();

        const status = {
          configured: hasCredentials(config),
          projectId: config.paperclipProjectId || null,
          dryRun: !!config.dryRun,
          lastFullSync: syncState.lastFullSync,
          totalSynced: syncState.totalSynced,
        };

        const lines = [
          `Todone.fyi Sync Status:`,
          `- API Key: ${status.configured ? 'configured' : 'NOT SET'}`,
          `- Project filter: ${status.projectId || 'all projects'}`,
          `- Dry run: ${status.dryRun}`,
          `- Last full sync: ${status.lastFullSync || 'never'}`,
          `- Total synced: ${status.totalSynced}`,
        ];

        return { content: lines.join('\n'), data: status };
      },
    );
  },

  async onHealth() {
    return { status: 'ok', message: 'Todone.fyi Sync plugin running' };
  },

  async onValidateConfig(config: Record<string, unknown>) {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.todoneApiKey) {
      errors.push('Todone.fyi API Key is required');
    } else if (typeof config.todoneApiKey === 'string' && !config.todoneApiKey.startsWith('td_')) {
      warnings.push('API Key does not start with td_ — verify it is correct');
    }

    if (config.dryRun) {
      warnings.push('Dry run mode is enabled — no changes will be made in Todone.fyi');
    }

    return { ok: errors.length === 0, errors, warnings };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
