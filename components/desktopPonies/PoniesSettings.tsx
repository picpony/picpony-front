'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdPets, MdRefresh } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import SearchInput from '@/components/SearchInput';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import CheckGlyph from '@/components/CheckGlyph';
import Skeleton from '@/components/Skeleton';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import SignInRequired from '@/components/SignInRequired';
import { showToast } from '@/components/Toast';
import { SettingsSection, SettingsRow, ROW_CLASS } from '@/app/settings/SettingsRow';
import { useSession, readToken } from '@/lib/hooks';
import { ponyCatalog, myPonies } from '@/lib/desktopPonies/queries';
import { filterPonies, PONY_PAGE_SIZE, ponyNameParts, ponyPreview, samePonySelection } from '@/lib/desktopPonies/chooser';
import { useResource, SKIP } from '@/lib/resource';
import { MAX_PONIES, saveMyPonies, type PonyChoice } from '@/lib/api/desktopPonies';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { ICON } from '@/lib/icons';
import { motionTier, useMotionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';
import { clamp, cn } from '@/lib/utils';
import PonyPreview from './PonyPreview';
import styles from './PoniesSettings.module.css';

/** A run of choices costs one write: the selection is saved once it has been still this long. */
const SAVE_AFTER_MS = 700;

export default function PoniesSettings() {
  const { token, ready } = useSession();
  return <PonySelection key={token ?? 'guest'} token={token} ready={ready} />;
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * 桌面小马, built the way the rest of /settings is: one grouped run of rows — who is with you, then
 * the catalogue to choose from — and **a choice takes effect as it is made**, like every switch on
 * the page. It used to be one elevated card with a chip per chosen pony repeating the grid's own
 * selection, a 56dp search field beside a 32dp chip, and a sticky 保存选择 bar that covered the
 * pager across a band of scroll; a pony changed on the page only once that button was found.
 *
 * Saving is debounced and serialised: a run of taps sends one `save_my_ponies`, a change made while
 * one is in flight is sent after it, and the runtime takes the saved selection from the same
 * resource and applies it in place (`PoniesRuntime`). A failure keeps the choice on screen and
 * offers 重试; it is never rolled back behind the user's back. Clearing the whole selection — the
 * one change a single tap cannot undo — is offered back through the toast's 撤销.
 */
function PonySelection({ token, ready }: { token: string | null; ready: boolean }) {
  /* Signed out the section is a sign-in prompt, and reads nothing. */
  const catalog = useResource(ponyCatalog, token ? {} : SKIP);
  const selection = useResource(myPonies, token ? { token } : SKIP);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<unknown>();
  /** The selection still to be written; null once the server has it. */
  const latest = useRef<string[] | null>(null);
  const timer = useRef(0);
  const saving = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const saved = selection.data ?? [];
  /* A saved draft gives way only once the resource shows it: `write` publishes on a paint boundary,
     so clearing the draft as the save landed showed the previous selection for one frame — the
     lineup reverted and replayed its motion 0.7s after the choice (M1-040). */
  if (draft && saveState === 'saved' && selection.data && samePonySelection(selection.data, draft)) setDraft(null);
  const chosen = draft ?? saved;
  const canEdit = !!token && selection.data !== undefined && catalog.data?.enabled === true;
  const ponies = catalog.data?.ponies ?? [];
  const matches = filterPonies(ponies, query, onlySelected, chosen);
  const pages = Math.max(1, Math.ceil(matches.length / PONY_PAGE_SIZE));
  const currentPage = clamp(page, 1, pages);
  const pageChoices = matches.slice((currentPage - 1) * PONY_PAGE_SIZE, currentPage * PONY_PAGE_SIZE);
  const atLimit = chosen.length >= MAX_PONIES;
  const offline = catalog.data ? chosen.filter((name) => !ponies.some((pony) => pony.name === name)) : [];

  async function flush() {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (!token || readToken() !== token || saving.current) return; // an in-flight save sends the rest when it lands
    const next = latest.current;
    if (!next) return;
    saving.current = true;
    setSaveState('saving');
    setSaveError(undefined);
    /* The request alone inside the `try`: the React Compiler lowers neither a `finally` nor a
       conditional inside a `try`, and either would skip this whole component. */
    let failed = false;
    let failure: unknown;
    try {
      await saveMyPonies(token, next);
    } catch (error) {
      failed = true;
      failure = error;
    }
    saving.current = false;
    const mine = readToken() === token;
    if (mine && failed) {
      setSaveError(failure);
      setSaveState('error');
    } else if (mine) {
      myPonies.write({ token }, next);
      if (latest.current && samePonySelection(latest.current, next)) {
        latest.current = null;
        setSaveState('saved');
      }
    }
    /* A newer selection arrived while this one was on the wire: send it now. The same one that
       just failed waits for 重试 — retrying it in a loop would hammer a backend that said no. */
    const pending = latest.current;
    if (pending && !(failed && samePonySelection(pending, next)) && readToken() === token && !timer.current) void flush();
  }
  function change(next: string[]) {
    if (!canEdit || next.length > MAX_PONIES) return;
    /* Back to what the server holds: nothing to send — unless a save is on the wire, which will
       overwrite it and has to be followed by this one. */
    const settled = samePonySelection(next, saved) && !saving.current;
    latest.current = settled ? null : next;
    setDraft(settled ? null : next);
    setSaveError(undefined);
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (settled) { setSaveState('idle'); return; }
    setSaveState('pending');
    timer.current = window.setTimeout(() => void flush(), SAVE_AFTER_MS);
  }
  /* The toast's 撤销 runs after this render's closures have gone stale. */
  const changeLatest = useRef(change);
  useEffect(() => { changeLatest.current = change; });
  function replaceAll(next: string[], message: string) {
    const before = chosen;
    change(next);
    showToast(message, 'success', { action: { label: '撤销', onClick: () => changeLatest.current(before) } });
  }
  function toggle(name: string, selected: boolean) {
    if (selected) { change(chosen.filter((item) => item !== name)); return; }
    if (atLimit) { showToast(`最多同时选择 ${MAX_PONIES} 个角色，先取消一个吧`, 'info'); return; }
    change([...chosen, name]);
  }
  /* Leaving the page with a choice still waiting sends it rather than dropping it. Through a ref:
     the unmount cleanup must reach the flush of the last render, not of the first. */
  const flushLatest = useRef(flush);
  useEffect(() => {
    flushLatest.current = flush;
  });
  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current) void flushLatest.current();
    };
  }, []);

  /* A failed read blocks the section only while there is nothing to show; a refresh that fails
     under a shown selection leaves it in place, as every read in the app does. */
  const problem = (catalog.data === undefined ? catalog.error : undefined) ?? (selection.data === undefined ? selection.error : undefined);
  const refresh = () => { catalog.refresh(); selection.refresh(); };
  const loading = catalog.data === undefined || selection.data === undefined;
  const status =
    saveState === 'pending' || saveState === 'saving' ? '正在保存…'
    : saveState === 'error' ? `未能保存：${apiErrorMessage(saveError)}`
    : saveState === 'saved' ? '已保存，会随账户同步'
    : offline.length ? `${offline.join('、')}已下线，不会出现在页面上`
    : '最多六个；减弱或关闭动画时会休息';
  const action =
    saveState === 'error' ? <Button variant="tonal" size="xs" onClick={() => void flush()}>重试</Button>
    : offline.length ? <Button variant="text" size="xs" disabled={!canEdit} onClick={() => replaceAll(chosen.filter((name) => !offline.includes(name)), '已移除下线的角色')}>移除已下线</Button>
    : chosen.length ? <Button variant="text" size="xs" disabled={!canEdit} onClick={() => replaceAll([], '已清空桌面小马')}>清空</Button>
    : undefined;

  return <SettingsSection
    title="桌面小马" icon={<MdPets size={ICON.control} />} subtitle="挑选喜欢的角色，陪你一起看图"
    actions={token ? <IconButton aria-label="刷新桌面小马" onClick={refresh} icon={<MdRefresh size={ICON.standard} />} /> : undefined}
    status={problem !== undefined && <ErrorRetry size="inline" title="桌面小马加载失败" message={apiErrorMessage(problem)} onRetry={isRetryable(problem) ? refresh : undefined} />}
  >
    {ready && !token ? <SignInRequired size="inline" description="登录后即可选择并保存桌面小马" />
      : catalog.data && !catalog.data.enabled ? <EmptyState title="桌面小马暂未开放" size="inline" />
      : loading && problem === undefined ? <ChooserSkeleton />
      : problem !== undefined ? null
      : !ponies.length ? <EmptyState title="暂无可选角色" size="inline" />
      : <>
        <SettingsRow
          label={chosen.length ? (atLimit ? `已选满 ${MAX_PONIES} 个` : `已选 ${chosen.length} / ${MAX_PONIES}`) : '还没有选择角色'}
          supporting={<span role="status" aria-atomic="true">{status}</span>}
          action={action}
        >
          <Lineup names={chosen} ponies={ponies} />
        </SettingsRow>
        <div className={cn(ROW_CLASS, 'flex-col items-stretch gap-3', styles.chooser)} data-pagination-anchor="">
          <div className="flex items-center gap-3">
            <SearchInput ref={search} value={query} placeholder="搜索角色名称…" aria-label="搜索桌面小马" className="min-w-0 flex-1"
              onChange={(value) => { setQuery(value); setPage(1); }} />
            <Chip variant="filter" selected={onlySelected} onClick={() => { setOnlySelected((value) => !value); setPage(1); }}>只看已选</Chip>
          </div>
          {matches.length ? <>
            <p className="flex items-center justify-between gap-3 text-body-s text-on-surface-variant">
              <span>{query.trim() ? `找到 ${matches.length} 个角色` : onlySelected ? '已选的角色' : '全部角色'}</span>
              {pages > 1 && <span className="tabular-nums">{`${(currentPage - 1) * PONY_PAGE_SIZE + 1}–${Math.min(currentPage * PONY_PAGE_SIZE, matches.length)} / ${matches.length}`}</span>}
            </p>
            <div className={styles.grid} role="group" aria-label="桌面小马角色">
              {pageChoices.map((pony) => {
                const selected = chosen.includes(pony.name);
                const display = ponyNameParts(pony.name);
                return <Card key={pony.name} interactive variant="filled" padding="sm" className={styles.choice} aria-pressed={selected} aria-label={pony.name}
                  onClick={() => toggle(pony.name, selected)}>
                  <span className={styles.mark} aria-hidden="true"><CheckGlyph className="size-4" /></span>
                  <PonyPreview key={pony.path} pony={pony} />
                  <span className={cn(styles.name, selected ? 'text-label-l-emphasized' : 'text-label-l')}>{display.name}</span>
                  <span className={cn(styles.variant, 'text-body-s', !selected && 'text-on-surface-variant')}>{display.variant || ' '}</span>
                </Card>;
              })}
            </div>
          </> : <EmptyState size="inline"
            title={onlySelected && !chosen.length ? '还没有选择角色' : '没有找到匹配的角色'}
            description={query.trim() ? '试试角色的中文名或英文名' : undefined}
            action={<Button variant="text" onClick={() => { setQuery(''); setOnlySelected(false); setPage(1); search.current?.focus(); }}>查看全部角色</Button>} />}
          {pages > 1 && <Pagination currentPage={currentPage} totalPages={pages} onPageChange={setPage} siblings={1} className="mt-0" />}
        </div>
      </>}
  </SettingsSection>;
}

/**
 * Who is with you: six places, filled in the order the ponies were chosen, so the limit is seen
 * rather than read. A pony that joins lands in its place; when one leaves, the ones after it close
 * the gap rather than jumping into it.
 */
function Lineup({ names, ponies }: { names: readonly string[]; ponies: readonly PonyChoice[] }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<readonly string[] | null>(null);
  const tier = useMotionTier();
  /* **A pony that leaves keeps its place while it goes.** Each slot is pinned to its own cell, so a
     leaver can stay in the cell it held, shrinking and fading on FastEffects under the pony that
     slides in over it — it used to vanish in the frame it was deselected, and 清空 emptied all six
     at once. Compared by content: the array is rebuilt on every render. */
  const key = names.join('\n');
  const [trail, setTrail] = useState<{ key: string; names: readonly string[]; leaving: readonly { name: string; index: number }[] }>(() => ({ key, names, leaving: [] }));
  if (trail.key !== key) {
    const gone = tier === 'off' ? [] : trail.names.flatMap((name, index) => (names.includes(name) ? [] : [{ name, index }]));
    setTrail({ key, names, leaving: [...trail.leaving.filter((item) => !names.includes(item.name) && !gone.some((next) => next.name === item.name)), ...gone] });
  }
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    for (const ghost of node.querySelectorAll<HTMLElement>('[data-leaving]:not([data-exiting])')) {
      ghost.setAttribute('data-exiting', '');
      const name = ghost.dataset.leaving;
      const timing = { ...springTiming('fastEffects'), fill: 'forwards' as const };
      ghost.animate([{ transform: 'none' }, { transform: 'scale(0.6)' }], timing);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing).finished.then(
        () => setTrail((current) => ({ ...current, leaving: current.leaving.filter((item) => item.name !== name) })),
        () => { /* Cancelled: the pony came back and its slot replaced the leaver. */ },
      );
    }
  }, [trail.leaving]);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = names;
    const node = root.current;
    if (!before || !node || motionTier() === 'off') return;
    const first = node.querySelector<HTMLElement>('[data-slot]');
    const step = first ? first.offsetWidth + (parseFloat(getComputedStyle(node).columnGap) || 0) : 0;
    names.forEach((name, index) => {
      const slot = node.querySelector<HTMLElement>(`[data-slot="${CSS.escape(name)}"]`);
      if (!slot) return;
      const was = before.indexOf(name);
      if (was === -1) {
        slot.animate([{ transform: 'scale(0.6)' }, { transform: 'none' }], springTiming('expressiveFastSpatial'));
        slot.animate([{ opacity: 0 }, { opacity: 1 }], springTiming('fastEffects'));
      } else if (was !== index && step) {
        slot.animate([{ transform: `translateX(${(was - index) * step}px)` }, { transform: 'none' }], springTiming('fastSpatial'));
      }
    });
  }, [names]);
  const sprite = (name: string) => {
    const pony = ponies.find((item) => item.name === name);
    const src = pony ? ponyPreview(pony) : null;
    /* eslint-disable-next-line @next/next/no-img-element -- the bundled first-frame previews, as in the grid. */
    return src ? <img src={src} alt="" draggable={false} className={styles.slotSprite} /> : <MdPets size={ICON.standard} className="text-on-surface-variant" />;
  };
  /* Painted in three layers within each cell: the empty place, a leaver above it, and a pony that
     has arrived or slid over the leaver on top. */
  return (
    <div ref={root} className={styles.lineup} aria-hidden="true">
      {Array.from({ length: MAX_PONIES }, (_, index) => {
        const name = names[index];
        const cell = { gridColumn: index + 1, gridRow: 1 };
        if (!name) return <span key={`empty-${index}`} className={styles.slot} style={cell} />;
        return <span key={name} data-slot={name} data-filled="" className={styles.slot} style={{ ...cell, zIndex: 2 }}>{sprite(name)}</span>;
      })}
      {trail.leaving.map(({ name, index }) => (
        <span key={`leaving-${name}`} data-leaving={name} data-filled="" className={styles.slot} style={{ gridColumn: index + 1, gridRow: 1, zIndex: 1 }}>{sprite(name)}</span>
      ))}
    </div>
  );
}

/** The loaded rows' shapes: the status row, then the chooser with its toolbar and one page of cards. */
function ChooserSkeleton() {
  return <div aria-busy="true" aria-label="正在加载桌面小马" data-page-loading="">
    <div className={cn(ROW_CLASS, 'flex-col items-stretch')}>
      <div className="min-w-0"><Skeleton className="h-5 w-24" /><Skeleton className="mt-1.5 h-4 w-48 max-w-full" /></div>
      <div className={styles.lineup}>{Array.from({ length: MAX_PONIES }, (_, i) => <Skeleton key={i} className="aspect-square w-full rounded-md" />)}</div>
    </div>
    <div className={cn(ROW_CLASS, 'flex-col items-stretch gap-3', styles.chooser)}>
      <div className="flex items-center gap-3"><Skeleton className="h-10 min-w-0 flex-1 rounded-sm" /><Skeleton className="h-8 w-20 rounded-sm" /></div>
      <Skeleton className="h-5 w-16" />
      <div className={styles.grid}>{Array.from({ length: PONY_PAGE_SIZE }, (_, i) => <div key={i} className={cn(styles.choice, 'rounded-md bg-surface-container-highest p-3')}>
        <span className={styles.preview}><Skeleton className="size-16" /></span><Skeleton className="h-5 w-24" /><Skeleton className="mt-1 h-4 w-12" />
      </div>)}</div>
    </div>
  </div>;
}
