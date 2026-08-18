import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { IsolationMode, Settings } from 'contract';
import { useSaveSettings, useSettings } from '@/api/queries';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buttonClass } from '@/lib/utils';

const DEFAULTS: Settings = { defaultProvider: 'claude', defaultTimeoutMinutes: 60, defaultIsolation: 'inline', baseBranch: null };

// Plain stacked form -- no settings sub-navigation at this scale. See
// cockpit-visual-design.md's "Settings view".
function SettingsView() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    await save.mutateAsync(form);
    setSaved(true);
  }

  return (
    <div className="flex-1 overflow-auto p-5">
      <form onSubmit={handleSubmit} className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="settings-provider">Default provider</Label>
          <Select value={form.defaultProvider} onValueChange={(v) => setForm((f) => ({ ...f, defaultProvider: v }))}>
            <SelectTrigger id="settings-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">claude</SelectItem>
              <SelectItem value="codex">codex</SelectItem>
              <SelectItem value="copilot">copilot</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-soft-foreground">Used when a job's own provider field is absent.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-timeout">Default timeout (minutes)</Label>
          <Input
            id="settings-timeout"
            type="number"
            min={1}
            value={form.defaultTimeoutMinutes}
            onChange={(e) => setForm((f) => ({ ...f, defaultTimeoutMinutes: Number(e.target.value) }))}
          />
          <p className="text-xs text-soft-foreground">Per-job ceiling before a synthetic BLOCKED.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-isolation">Default isolation mode</Label>
          <Select
            value={form.defaultIsolation}
            onValueChange={(v) => setForm((f) => ({ ...f, defaultIsolation: v as IsolationMode }))}
          >
            <SelectTrigger id="settings-isolation" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inline">inline</SelectItem>
              <SelectItem value="worktree">worktree</SelectItem>
              <SelectItem value="chained">chained</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2.5">
          <button type="submit" disabled={save.isPending} className={buttonClass('primary', 'sm')}>
            Save
          </button>
          {saved && <span className="text-xs text-success">Saved.</span>}
        </div>
      </form>
    </div>
  );
}

export { SettingsView };
