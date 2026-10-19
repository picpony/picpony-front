'use client';
import { useState } from 'react';
import Button from '@/components/Button';
import DropZone from '@/components/DropZone';
import ErrorRetry from '@/components/ErrorRetry';
import { showToast } from '@/components/Toast';
import { apiErrorMessage } from '@/lib/api/errors';
import { CatalogOutcomeUnknown, catalogWrite } from '@/lib/api/adminCatalogTools';
import { adminUploadMascotImage } from '@/lib/api/admin';
import { IMAGE_LIMIT, assetUrl, validateImage } from '@/lib/adminCatalogTools/model';
import { formatBytes } from '@/lib/format';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

/** Decode the upload outside the component; the compiler cannot lower its guarded URL read. */
async function uploadAsset(token: string, kind: 'mascot', file: File) {
  validateImage(file, kind);
  const data = await catalogWrite(() => adminUploadMascotImage(token, file));
  /* The stored file's site path (`/api/v1/mascots/images/{asset}`) — what a mascot row keeps. */
  try { return assetUrl(data.url); }
  catch { throw new CatalogOutcomeUnknown(); }
}

/**
 * A catalogue picture upload. Only the mascot has an upload endpoint on this backend
 * (`POST /admin/mascots/images`); shop items take an address (`ShopTab`).
 */
export default function CatalogImageInput({ token, kind, disabled, onUploaded, onBusy }: { token: string; kind: 'mascot'; disabled?: boolean; onUploaded: (url: string) => void; onBusy?: (value: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  /* A refused file is not a failed operation: it has to read as 文件未选中 on the drop zone, not as
     操作未完成 in `MutationResult`, which is for the outcome of an upload that was actually sent. */
  const [refused, setRefused] = useState('');
  const mutation = useCatalogMutation(token);
  function select(value: File) { try { validateImage(value, kind); setFile(value); setRefused(''); mutation.report(''); } catch (error) { setFile(null); setRefused(apiErrorMessage(error)); } }
  async function upload() {
    if (!file || mutation.busy || mutation.uncertain) return;
    onBusy?.(true);
    await mutation.run(() => uploadAsset(token, kind, file), (url) => { onUploaded(url); setFile(null); showToast('已上传图片', 'success'); });
    onBusy?.(false);
  }
  return <div className="space-y-3">
    <DropZone size="sm" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="选择吉祥物图片" disabled={disabled || mutation.busy} filled={Boolean(file)} onFile={select} onReject={select}>
      <p className="break-words text-body-m">{file ? `${file.name} · ${formatBytes(file.size)}` : `选择或拖入图片（最多 ${IMAGE_LIMIT[kind] / 1024 / 1024} MB）`}</p>
    </DropZone>
    {refused && <ErrorRetry size="inline" title="文件未选中" message={refused} />}
    {file && <div className="flex flex-wrap gap-2"><Button type="button" variant="tonal" onClick={() => void upload()} loading={mutation.busy} disabled={disabled || mutation.uncertain}>上传图片</Button><Button type="button" variant="text" disabled={disabled || mutation.busy} onClick={() => setFile(null)}>移除文件</Button></div>}
    <MutationResult mutation={mutation} />
  </div>;
}
