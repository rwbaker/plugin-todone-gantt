import { useState, useEffect } from 'react';
import { usePluginData, usePluginAction, useHostContext } from '@paperclipai/plugin-sdk/ui';

interface Project {
  id: string;
  name: string;
}

export function SettingsPage() {
  const context = useHostContext();
  const companyId = context?.companyId ?? '';

  const { data: projects, loading: projectsLoading } = usePluginData<Project[]>(
    'projects',
    { companyId },
  );

  const { data: syncStatus, loading: statusLoading, refresh: refreshStatus } = usePluginData<{
    hasApiKey: boolean;
    projectId: string | null;
    dryRun: boolean;
    lastFullSync: string | null;
    totalSynced: number;
  }>('sync-status', {});

  const saveProject = usePluginAction('save-project');

  const [selectedProject, setSelectedProject] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (syncStatus?.projectId) {
      setSelectedProject(syncStatus.projectId);
    }
  }, [syncStatus?.projectId]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await saveProject({ projectId: selectedProject || null });
      setMessage('Saved!');
      refreshStatus();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const projectName = projects?.find((p) => p.id === syncStatus?.projectId)?.name;

  return (
    <div style={{ maxWidth: 480, padding: 16 }}>
      <h3 style={{ margin: '0 0 16px' }}>Todone.fyi Sync Settings</h3>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Status</div>
        {statusLoading ? (
          <div>Loading...</div>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div>API Key: {syncStatus?.hasApiKey ? '✓ configured' : '✗ not set'}</div>
            <div>Last sync: {syncStatus?.lastFullSync ? new Date(syncStatus.lastFullSync).toLocaleString() : 'never'}</div>
            <div>Synced tasks: {syncStatus?.totalSynced ?? 0}</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="project-select"
          style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}
        >
          Paperclip Project
        </label>
        <select
          id="project-select"
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          disabled={projectsLoading}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            borderRadius: 4,
            border: '1px solid #ccc',
          }}
        >
          <option value="">All projects</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.id.substring(0, 8)}…)
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          Select which project to sync to Todone.fyi, or leave as "All projects" to sync everything.
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '6px 16px',
          fontSize: 13,
          borderRadius: 4,
          border: '1px solid #ccc',
          cursor: saving ? 'wait' : 'pointer',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>

      {message && (
        <span style={{ marginLeft: 8, fontSize: 13, color: message.startsWith('Error') ? 'red' : 'green' }}>
          {message}
        </span>
      )}
    </div>
  );
}
