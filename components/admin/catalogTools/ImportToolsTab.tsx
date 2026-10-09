'use client';
import { useRef, useState } from 'react';
import Button from '@/components/Button';
import DropZone from '@/components/DropZone';
import ErrorRetry from '@/components/ErrorRetry';
import { Input } from '@/components/Input';
import ProgressBar from '@/components/ProgressBar';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { formatBytes, formatDateTime } from '@/lib/format';
import { apiErrorMessage } from '@/lib/api/errors';
import * as api from '@/lib/api/adminCatalogTools';
import { readImport } from '@/lib/adminCatalogTools/importClient';
import { validatePackage, type Dataset, type ImportPhase } from '@/lib/adminCatalogTools/importModel';
import { integer } from '@/lib/adminCatalogTools/model';
import { epochStamp } from '@/lib/adminSiteTools/model';

/** 上次成功更新, its unit read from the magnitude like every other stamp from this backend
 *  (`epochStamp`; review P6-O9) rather than assumed to be seconds. */
function updatedLabel(value: unknown): string {
  const stamp = epochStamp(value);
  return typeof stamp === 'number' ? formatDateTime(stamp) : stamp ?? '暂无更新记录';
}
import type { AdminPanelProps } from '../registry';
import SectionHeader from '../SectionHeader';
import RefreshButton from '../RefreshButton';
import { AdminForm, AdminNote, FormActions } from '../AdminForm';
import { defineAdminQuery, retryError, useAdminQuery } from '../queries';
import { useImportTask } from './useImportTask';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

type Tab = Dataset | 'translation';
const tabs: { value: Tab; label: string }[] = [{ value: 'images', label: '图片标签' }, { value: 'dictionary', label: '词库更新包' }, { value: 'translation', label: '翻译维护' }];
const lastUpdated = {
  images: defineAdminQuery('image-tags-update', async (token, signal) => integer((await readImport('images', token, 'last_update', undefined, signal)).updated_at)),
  dictionary: defineAdminQuery('dictionary-update', async (token, signal) => integer((await readImport('dictionary', token, 'last_update', undefined, signal)).updated_at)),
};
const PHASE: Record<ImportPhase, string> = { uploading: '正在上传', paused: '上传已暂停', staged: '上传完成，等待确认导入', submitted: '已提交，等待服务器处理', processing: '服务器正在处理', done: '导入完成', error: '导入未全部完成', unknown: '提交结果待核对' };
const COUNT_LABELS: Record<string, string> = { image_count: '图片数量', valid_count: '有效标签', created_count: '新增词条', updated_count: '更新词条', skipped_count: '跳过记录', failed_count: '失败记录' };
export default function ImportToolsTab(props: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>('images');
  const [visited, setVisited] = useState<Tab[]>(['images']);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  return <div className="space-y-6"><SectionHeader section="data-import" /><Tabs value={tab} onChange={setTab} tabs={tabs} activation="manual" label="数据维护分区" /><TabPanes value={tab}><TabPane value="images"><DatasetPane {...props} dataset="images" active={tab === 'images'} /></TabPane><TabPane value="dictionary">{visited.includes('dictionary') && <DatasetPane {...props} dataset="dictionary" active={tab === 'dictionary'} />}</TabPane><TabPane value="translation">{visited.includes('translation') && <TranslationPane token={props.token} />}</TabPane></TabPanes></div>;
}
function DatasetPane({ token, viewerId, dataset, active }: AdminPanelProps & { dataset: Dataset; active: boolean }) {
  const read = useAdminQuery(lastUpdated[dataset], token);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const task = useImportTask(token, viewerId, dataset, active, paneRef);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const { confirmThen, confirmDialog } = useConfirm();
  const job = task.job;
  function select(value: File) { try { validatePackage(value, dataset); setFile(value); setFileError(''); } catch (error) { setFileError(apiErrorMessage(error)); } }
  const submitted = Boolean(job && ['submitted', 'processing', 'unknown'].includes(job.phase));
  const stage = () => { if (file) { setStopRequested(false); void task.stage(file); } };
  return <div ref={paneRef} className="space-y-6">
    <AdminNote>{dataset === 'images' ? '上传图片标签数据库，或让服务器从公开文件直链下载。上传完成后需确认校验并替换现有数据。' : '导入 PPSync 词库更新包，新增或更新其中的词条。已提交的导入会在服务器继续执行。'}</AdminNote>
    <div className="flex flex-wrap items-center gap-3"><p className="text-body-m text-on-surface-variant">上次成功更新：{read.data === undefined ? read.loading ? '读取中…' : '读取失败' : read.data ? updatedLabel(read.data) : '暂无更新记录'}</p><RefreshButton onClick={read.refresh} label="刷新更新时间" loading={read.refreshing} /></div>
    {read.error && <ErrorRetry size="inline" {...retryError('更新时间加载失败', read.error)} onRetry={read.retryable ? read.refresh : undefined} />}
    <DropZone size="md" aria-label={dataset === 'images' ? '选择图片标签数据文件' : '选择词库更新包'} accept={dataset === 'images' ? '.db,.sqlite,.zip,.gz' : '.ppsync'} disabled={task.busy || submitted || job?.phase === 'staged'} filled={Boolean(file)} onFile={select} onReject={select}><p className="text-body-m break-words">{file ? `${file.name} · ${formatBytes(file.size)}` : dataset === 'images' ? '选择 DB、SQLite、ZIP 或 GZ 文件（最多 8 GB）' : '选择 PPSync 更新包（最多 256 MB）'}</p></DropZone>
    {fileError && <ErrorRetry size="inline" title="文件未选中" message={fileError} />}
    {dataset === 'images' ? <div className="flex flex-wrap gap-3"><Button variant="tonal" loading={task.busy && job?.phase === 'uploading'} disabled={!file || submitted || task.busy || Boolean(job && !['paused', 'uploading'].includes(job.phase))} onClick={stage}>{job?.phase === 'paused' ? '核对分片并继续上传' : '上传文件'}</Button>{task.busy && job?.phase === 'uploading' && <Button variant="text" onClick={() => { task.stop(); setStopRequested(true); }} disabled={stopRequested}>{stopRequested ? '将在当前分片结束后暂停' : '暂停上传'}</Button>}{job?.phase === 'staged' && <Button loading={task.busy} onClick={() => confirmThen('确认替换图片标签数据', `确定要校验并导入「${job.filename}」吗？上传的 ${job.totalChunks} 个分片会合并并替换现有图片标签数据，提交后不能取消。`, () => void task.submit())}>校验并导入</Button>}</div> : <Button disabled={!file || Boolean(job)} loading={task.busy} onClick={() => confirmThen('确认导入词库', `确定要导入「${file?.name ?? ''}」吗？将新增或更新包内词条，提交后不能取消。`, () => void task.submit(file ?? undefined))}>导入词库更新包</Button>}
    {dataset === 'images' && !job && <AdminForm aria-label="从文件直链导入" onSubmit={() => confirmThen('确认从直链导入', '确定要从所填直链下载并替换图片标签数据吗？提交后不能取消，请先确认文件内容。', () => void task.submit(undefined, url))}><Input label="文件直链" value={url} maxLength={2048} readOnly={task.busy} placeholder="https://example.com/data.db.gz" onChange={(event) => setUrl(event.target.value)} /><FormActions><Button type="submit" variant="tonal" loading={task.busy} disabled={!url.trim()}>从直链导入</Button></FormActions></AdminForm>}
    {job && <section aria-label="导入进度" className="space-y-3"><p className="text-body-m-emphasized" role="status">{PHASE[job.phase]}</p><p className="break-all text-body-s text-on-surface-variant">任务编号：{job.id}</p><ProgressBar value={job.percent} label={PHASE[job.phase]} /><p className="text-body-s">{job.totalChunks ? `已确认 ${job.chunks.length} / ${job.totalChunks} 个分片` : '服务器将校验并导入文件'}</p>{job.counts && <dl className="grid grid-cols-2 gap-2 text-body-m">{Object.entries(job.counts).map(([name, value]) => <div key={name}><dt className="text-on-surface-variant">{COUNT_LABELS[name] ?? name}</dt><dd>{value}</dd></div>)}</dl>}
      {submitted && <><AdminNote>服务器可能仍在执行。停止查看进度不会取消导入，请核对当前任务，勿重复提交。</AdminNote><div className="flex flex-wrap gap-2"><Button variant="tonal" onClick={() => void task.check()}>核对任务状态</Button><Button variant="text" onClick={() => task.setWatching(!task.watching)}>{task.watching ? '停止查看进度' : '继续查看进度'}</Button></div></>}
      {['done', 'error', 'paused', 'staged'].includes(job.phase) && !task.busy && <Button variant="text" onClick={() => confirmThen('确认新建任务', job.phase === 'paused' || job.phase === 'staged' ? '确定要放弃本机的分片续传记录并新建任务吗？服务器已有分片不会自动删除，尚未提交的导入不会执行。' : '确定要清除当前任务的本机记录并新建导入吗？', () => { task.reset(); setFile(null); read.refresh(); })}>新建导入</Button>}
    </section>}
    {task.error && <ErrorRetry size="inline" title={submitted ? '导入结果待核对' : '导入未完成'} message={task.error} />}
    {task.recoveryBlocked && <Button variant="text" onClick={() => confirmThen('确认清除损坏记录', '已在服务器核对过该账号的导入结果，并确定要清除本机损坏记录吗？清除记录不会取消服务器任务。', task.reset)}>已核对，清除损坏记录</Button>}
    {confirmDialog}
  </div>;
}
function TranslationPane({ token }: { token: string }) {
  const queue = useCatalogMutation(token); const failures = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  return <div className="space-y-6"><AdminNote>仅在队列停滞或需要重新尝试失败任务时维护。清空队列会把排队和翻译中的任务标记为失败。</AdminNote><div className="flex flex-wrap gap-3"><Button variant="danger" loading={queue.busy} disabled={queue.uncertain} onClick={() => confirmThen('确认清空翻译队列', '确定要将全部排队和翻译中的任务标记为失败吗？已经提交的清理不能取消。', () => void queue.run(() => api.clearTranslationQueue(token), () => showToast('已清空翻译队列', 'success')))}>清空翻译队列</Button><Button variant="tonal" loading={failures.busy} disabled={failures.uncertain} onClick={() => confirmThen('确认重置失败计数', '确定要重置全部图片的翻译失败计数吗？系统将可以重新尝试这些任务。', () => void failures.run(() => api.clearTranslationFailures(token), () => showToast('已重置翻译失败计数', 'success')))}>重置失败计数</Button></div><MutationResult mutation={queue} /><MutationResult mutation={failures} />{confirmDialog}</div>;
}
