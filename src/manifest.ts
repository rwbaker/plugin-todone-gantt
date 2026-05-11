const manifest = {
  id: 'todone-gantt',
  apiVersion: 1 as const,
  version: '0.2.0',
  displayName: 'Todone.fyi Sync',
  description: 'Syncs Paperclip issues to Todone.fyi tasks for Gantt chart visualization',
  author: 'SGNL Studio',
  categories: ['automation'] as const,

  capabilities: [
    'jobs.schedule',
    'plugin.state.read',
    'plugin.state.write',
    'http.outbound',
    'events.subscribe',
    'issues.read',
    'agent.tools.register',
    'projects.read',
    'companies.read',
    'ui.page.register',
  ] as const,

  entrypoints: {
    worker: 'dist/worker.mjs',
    ui: 'dist/ui',
  },

  ui: {
    slots: [
      {
        type: 'settingsPage',
        id: 'todone-settings',
        displayName: 'Todone.fyi Settings',
        exportName: 'SettingsPage',
      },
    ],
  },

  instanceConfigSchema: {
    type: 'object',
    properties: {
      todoneApiKey: {
        type: 'string',
        title: 'Todone.fyi API Key',
        description: 'Bearer token for the Todone.fyi API (starts with td_)',
      },
      todoneBaseUrl: {
        type: 'string',
        title: 'Todone.fyi Base URL',
        description: 'Base URL for the Todone.fyi API',
        default: 'https://www.todone.fyi',
      },
      paperclipProjectId: {
        type: 'string',
        title: 'Paperclip Project',
        description: 'Limit sync to a specific Paperclip project (optional — syncs all if empty)',
      },
      defaultDurationMinutes: {
        type: 'number',
        title: 'Default task duration (minutes)',
        description: 'Duration assigned to synced tasks that have no estimate',
        default: 60,
      },
      dryRun: {
        type: 'boolean',
        title: 'Dry run mode',
        description: 'Log sync actions without making Todone.fyi API calls',
        default: false,
      },
    },
  },

  jobs: [
    {
      jobKey: 'reconcile-sync',
      displayName: 'Reconcile Sync',
      description: 'Full reconciliation of Paperclip issues to Todone.fyi tasks',
    },
  ],

};

export default manifest;
