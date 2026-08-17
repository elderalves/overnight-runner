import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { IsolationMode, Job } from 'contract';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buttonClass } from '@/lib/utils';
import { client } from '@/api/client';

type ComposerMode = 'create' | 'edit' | 'duplicate';

interface JobComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ComposerMode;
  job: Job | null;
  queue: Job[];
  onSaved: () => void;
}

interface FormFields {
  slug: string;
  isolation: IsolationMode;
  provider: string;
  chainFrom: string;
  body: string;
}

const NO_PROVIDER = '__default__';
const NO_CHAIN = '__none__';

// Pre-fill is purely client-side -- the browser already holds the full queue
// array (with body) via SSE, so there's no GET /api/jobs/:identity to await.
// Duplicate always forces a blank slug and clears chain_from, falling back
// to inline isolation if the source was chained. See job-authoring-ux.md.
function initialFields(mode: ComposerMode, job: Job | null): FormFields {
  if (!job || mode === 'create') {
    return { slug: '', isolation: 'inline', provider: '', chainFrom: '', body: '' };
  }
  if (mode === 'duplicate') {
    return {
      slug: '',
      isolation: job.isolation === 'chained' ? 'inline' : (job.isolation as IsolationMode),
      provider: job.provider ?? '',
      chainFrom: '',
      body: job.body,
    };
  }
  return {
    slug: job.identity,
    isolation: job.isolation as IsolationMode,
    provider: job.provider ?? '',
    chainFrom: job.chainFrom ?? '',
    body: job.body,
  };
}

function JobComposer({ open, onOpenChange, mode, job, queue, onSaved }: JobComposerProps) {
  const [fields, setFields] = useState<FormFields>(() => initialFields(mode, job));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFields(initialFields(mode, job));
      setErrors({});
      setBanner(null);
    }
  }, [open, mode, job]);

  const isEdit = mode === 'edit';
  const title = isEdit ? `Edit ${job?.identity}` : mode === 'duplicate' ? `Duplicate ${job?.identity}` : 'New job';
  const chainCandidates = queue.filter((j) => j.identity !== job?.identity);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setBanner(null);

    const payload = {
      isolation: fields.isolation,
      provider: fields.provider || null,
      chainFrom: fields.isolation === 'chained' ? fields.chainFrom || null : null,
      body: fields.body,
    };

    try {
      const res = isEdit
        ? await client.api.jobs[':identity'].$put({ param: { identity: job!.identity }, json: payload })
        : await client.api.jobs.$post({ json: { ...payload, slug: fields.slug } });

      if (!res.ok) {
        const problem = (await res.json()) as { errors?: Record<string, string>; error?: string };
        if (problem.errors) setErrors(problem.errors);
        else setBanner(problem.error ?? 'Save failed');
        return;
      }

      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-auto px-4">
            {banner && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}

            <div className="space-y-1.5">
              <Label htmlFor="cf-slug">Slug</Label>
              <Input
                id="cf-slug"
                value={fields.slug}
                disabled={isEdit}
                onChange={(e) => setFields((f) => ({ ...f, slug: e.target.value }))}
                placeholder="06-my-next-job"
              />
              {errors.slug && <p className="text-xs text-danger">{errors.slug}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-isolation">Isolation</Label>
              <Select value={fields.isolation} onValueChange={(v) => setFields((f) => ({ ...f, isolation: v as IsolationMode }))}>
                <SelectTrigger id="cf-isolation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inline">inline</SelectItem>
                  <SelectItem value="worktree">worktree</SelectItem>
                  <SelectItem value="chained">chained</SelectItem>
                </SelectContent>
              </Select>
              {errors.isolation && <p className="text-xs text-danger">{errors.isolation}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-provider">Provider</Label>
              <Select
                value={fields.provider || NO_PROVIDER}
                onValueChange={(v) => setFields((f) => ({ ...f, provider: v === NO_PROVIDER ? '' : v }))}
              >
                <SelectTrigger id="cf-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROVIDER}>— use default —</SelectItem>
                  <SelectItem value="claude">claude</SelectItem>
                  <SelectItem value="codex">codex</SelectItem>
                  <SelectItem value="copilot">copilot</SelectItem>
                </SelectContent>
              </Select>
              {errors.provider && <p className="text-xs text-danger">{errors.provider}</p>}
            </div>

            {fields.isolation === 'chained' && (
              <div className="space-y-1.5">
                <Label htmlFor="cf-chain">Chain from</Label>
                <Select
                  value={fields.chainFrom || NO_CHAIN}
                  onValueChange={(v) => setFields((f) => ({ ...f, chainFrom: v === NO_CHAIN ? '' : v }))}
                >
                  <SelectTrigger id="cf-chain" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CHAIN}>—</SelectItem>
                    {chainCandidates.map((j) => (
                      <SelectItem key={j.identity} value={j.identity}>
                        {j.identity}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.chainFrom && <p className="text-xs text-danger">{errors.chainFrom}</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cf-body">Body</Label>
              <Textarea
                id="cf-body"
                rows={8}
                value={fields.body}
                onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))}
                placeholder="Task description... optional - [ ] checklist"
              />
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2">
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={buttonClass('primary', 'sm')}>
              {isEdit ? 'Save' : 'Create job'}
            </button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export { JobComposer };
export type { ComposerMode };
