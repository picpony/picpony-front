'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MdBrokenImage, MdCheck, MdClose, MdCloudUpload, MdKey, MdOpenInNew, MdSettings } from 'react-icons/md';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import { useConfirm } from '@/components/ConfirmDialog';
import DropZone from '@/components/DropZone';
import EmptyState from '@/components/EmptyState';
import IconButton from '@/components/IconButton';
import { Input, Textarea } from '@/components/Input';
import PageHeader from '@/components/PageHeader';
import ProgressBar from '@/components/ProgressBar';
import Radio from '@/components/Radio';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import TagComboField, { type TagComboFieldHandle } from '@/components/groups/TagComboField';
import TagWell from '@/components/groups/TagWell';
import { settingsHref } from '@/app/settings/tabs';
import {
  MIN_UPLOAD_TAGS,
  RATING_TAGS,
  UPLOAD_ACCEPT,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  type RatingTag,
} from '@/lib/api/upload';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { scrollAppToTop } from '@/lib/scrollTo';
import {
  UPLOAD_MAX_TAG_INPUT,
  uploadDescriptionProblem,
  uploadSourceUrl,
  uploadTagInput,
} from '@/lib/uploadLimits';
import { cn } from '@/lib/utils';
import SizeSwap from './SizeSwap';
import UploadQuickTags from './UploadQuickTags';
import {
  attachUploadScreen,
  cancelUpload,
  clearOutcome,
  resetUpload,
  startUpload,
  updateDraft,
  useUpload,
  type UploadDraft,
  type UploadJob,
  type UploadOutcome,
} from './uploadStore';

const RATINGS = new Set<string>(RATING_TAGS.map((rating) => rating.tag));
const DERPI_RULES = 'https://derpibooru.org/pages/rules';
/** Derpibooru's own search for the signed-in account's uploads. */
const DERPI_MY_UPLOADS = 'https://derpibooru.org/search?q=my%3Auploads';
/** How long a picked file may take to report its size before the zone says it is reading it. */
const READING_GRACE_MS = 200;
/** The longest wait for that size; past it the preview shows without a reserved box. */
const MEASURE_TIMEOUT_MS = 4000;
/**
 * The longest a landing result waits for the page to glide back to its top: the glide's own
 * band tops out at 1100ms at the default speed (`lib/scrollTo.ts`), and a wall-clock bound on a
 * motion takes the slowest speed's scale.
 */
const LANDING_GLIDE_CAP_MS = 1100 * MOTION_SPEED_SCALE.slow + 200;

type Errors = Partial<Record<'file' | 'rating' | 'tags' | 'source' | 'description', string>>;

interface MediaSize {
  width: number;
  height: number;
}

/** A picked file as the zone shows it: its address, and its own size once read (`null`: unreadable). */
interface Preview {
  file: File;
  url: string;
  size: MediaSize | null;
}

type NoticeOutcome = Exclude<UploadOutcome, { kind: 'uploaded' }>;

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function fileProblem(file: File): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return '不支持这种文件格式，请选择 PNG / JPG / GIF / WebP 图片或 WebM / MP4 视频';
  }
  if (file.size > UPLOAD_MAX_BYTES) return `文件为 ${megabytes(file.size)} MB，超过 50 MB 的上限`;
  return null;
}

/**
 * A source, when there is one, is a whole web address — what Derpibooru stores — and one the
 * submit hop forwards: the same check (`uploadSourceUrl`), so the form never accepts an address
 * the hop then refuses as 「来源链接无效」 (review P4-F2: one with a user name in it, or a long one).
 */
function sourceProblem(value: string): string | null {
  const text = value.trim();
  if (!text || uploadSourceUrl(text)) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password) return '来源链接不能包含用户名或密码';
  } catch {
    /* Not a URL at all. */
  }
  return '请输入以 http:// 或 https:// 开头的完整链接';
}

function validate(draft: UploadDraft): Errors {
  const errors: Errors = {};
  if (!draft.file) errors.file = '请先选择要发布的图片或视频';
  else {
    const problem = fileProblem(draft.file);
    if (problem) errors.file = problem;
  }
  if (!draft.rating) errors.rating = '请选择一个分级';
  const count = draft.tags.length + (draft.rating ? 1 : 0);
  if (count < MIN_UPLOAD_TAGS) {
    errors.tags = `至少需要 ${MIN_UPLOAD_TAGS} 个标签（含分级），还差 ${MIN_UPLOAD_TAGS - count} 个`;
  } else if (uploadTagInput(draft.rating, draft.tags).length > UPLOAD_MAX_TAG_INPUT) {
    errors.tags = `标签总长度超过 ${UPLOAD_MAX_TAG_INPUT} 个字符，请删减部分标签`;
  }
  const source = sourceProblem(draft.source);
  if (source) errors.source = source;
  const description = uploadDescriptionProblem(draft.description);
  if (description) errors.description = description;
  return errors;
}

/**
 * A picked file's own size, read before its preview is shown, so the zone opens once, to the box
 * the preview fills (M1-025) — it opened to a 0px image, then again to the decoded one. `null`
 * when the browser cannot read the file; the preview then says so rather than showing a broken
 * picture.
 */
function measureMedia(file: File, url: string): Promise<MediaSize | null> {
  return new Promise((resolve) => {
    let settled = false;
    let release = () => {};
    const timer = window.setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
    function finish(size: MediaSize | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      release();
      resolve(size);
    }
    if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      release = () => {
        video.removeAttribute('src');
        video.load();
      };
      video.onloadedmetadata = () =>
        finish(video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
      video.onerror = () => finish(null);
      video.src = url;
      return;
    }
    const image = new Image();
    image.src = url;
    /* `decode`, not `load`: the preview then paints whole in the frame its box opens. */
    image.decode().then(
      () => finish(image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null),
      () => finish(null),
    );
  });
}

function UploadSkeleton() {
  return (
    <div data-page-loading aria-hidden="true" className="space-y-6">
      <Skeleton className="h-56 w-full rounded-md" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-14 w-full rounded-xs" />
      <Skeleton className="h-14 w-full rounded-xs" />
      <Skeleton className="h-24 w-full rounded-xs" />
      <Skeleton className="h-14 w-full rounded-full" />
    </div>
  );
}

/**
 * What the file looks like once picked — the picture, or the video with its own controls — in a
 * box reserved from the file's own size: as wide as the zone, the file and the height cap each
 * allow (50% of the window for a picture, 40% for a video, whose controls need the room), which is
 * exactly where the media used to settle after it had loaded. `preview` is `null` while the file is
 * still being read.
 */
function FilePreview({
  file,
  preview,
  disabled,
  onRemove,
}: {
  file: File;
  preview: Preview | null;
  disabled: boolean;
  onRemove: () => void;
}) {
  const video = file.type.startsWith('video/');
  const size = preview?.size ?? null;
  const box = size
    ? {
        aspectRatio: `${size.width} / ${size.height}`,
        width: `min(100%, ${size.width}px, calc(${video ? 40 : 50}vh * ${size.width / size.height}))`,
      }
    : undefined;
  let media: ReactNode;
  if (preview === null) {
    media = <Skeleton className="h-48 w-64 max-w-full rounded-md" />;
  } else if (video) {
    /* The video takes its own pointer events back from the zone (whose target lies behind the
       content): its controls play, pause and seek, and never open the picker (R7-007). */
    media = (
      <video
        src={preview.url}
        controls
        preload="metadata"
        className={cn('pointer-events-auto rounded-md', size ? 'block size-full' : 'max-h-[40vh] max-w-full')}
      />
    );
  } else if (size) {
    // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
    media = <img src={preview.url} alt="已选择的作品预览" className="block size-full rounded-md object-contain" />;
  } else {
    media = (
      <div className="flex h-48 w-64 max-w-full flex-col items-center justify-center gap-2 rounded-md bg-surface-container-highest px-4 text-on-surface-variant forced-boundary">
        <MdBrokenImage size={ICON.large} aria-hidden="true" />
        <p className="text-body-s">无法预览此文件</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="relative max-w-full" style={box}>
        {media}
        {/* A real control beside the zone's own target, not inside it (R1-023, R11-022). */}
        <IconButton
          size="sm"
          variant="danger"
          dismiss
          disabled={disabled}
          aria-label="移除文件"
          icon={<MdClose />}
          onClick={onRemove}
          className="absolute -right-3 -top-3"
        />
      </div>
      <p className="max-w-full text-body-s text-on-surface-variant">
        <span className="break-all">{file.name || '未命名文件'}</span> · {megabytes(file.size)} MB
        <span className="block">{video ? '点击视频以外的区域可更换文件' : '点击此区域可更换文件'}</span>
      </p>
    </div>
  );
}

/**
 * A status row that opens and closes by its own height on DefaultEffects — the offline banner's
 * arrangement — so what follows it glides instead of jumping (M1-026: the progress row pushed the
 * submit button 68px in a frame). Its content is held by the caller while it closes; closed, it
 * is out of the tab order and the accessibility tree. The clip keeps a 4px margin, so a focused
 * control at the row's edge keeps its whole ring.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      aria-hidden={open ? undefined : true}
      className={cn('grid spring-default-effects transition-[grid-template-rows,opacity]', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0')}
    >
      <div className="min-h-0 overflow-clip [overflow-clip-margin:4px]">{children}</div>
    </div>
  );
}

/**
 * The last attempt's outcome, said under the form (field complaints are on their fields). `live`
 * while it is the current outcome — a new one mounts a new alert, which is what makes it heard —
 * and quiet while its row closes.
 */
function OutcomeNotice({ outcome, live }: { outcome: NoticeOutcome; live: boolean }) {
  if (outcome.kind === 'unconfirmed') {
    return (
      <div role={live ? 'alert' : undefined} className="rounded-md bg-warning-container p-4 text-body-m text-on-warning-container">
        <p>{outcome.message}</p>
        <a
          href={DERPI_MY_UPLOADS}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-label-l underline underline-offset-2"
        >
          在 Derpibooru 查看我的上传
          <MdOpenInNew size={ICON.dense} aria-hidden="true" />
        </a>
      </div>
    );
  }
  return (
    <p role={live ? 'alert' : undefined} className="rounded-md bg-error-container p-4 text-body-m text-on-error-container">
      {outcome.message}
    </p>
  );
}

/** The upload's progress, as its row shows it (the sentence itself is announced by the page). */
function ProgressRow({ job, onCancel }: { job: UploadJob; onCancel: () => void }) {
  const staging = job.phase === 'staging';
  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p aria-hidden="true" className="text-body-m text-on-surface-variant">
          {staging ? '正在上传文件' : '正在提交到 Derpibooru，请稍候'}
          {staging && job.progress !== null && (
            <span className="ml-2 tabular-nums">{Math.round(job.progress * 100)}%</span>
          )}
        </p>
        {staging && (
          <Button type="button" variant="text" size="xs" onClick={onCancel}>
            取消上传
          </Button>
        )}
      </div>
      <ProgressBar
        value={staging && job.progress !== null ? job.progress * 100 : undefined}
        label={staging ? '文件上传进度' : '正在提交到 Derpibooru'}
      />
    </div>
  );
}

/**
 * 发布图片 — the original front end's flow, ported (R7-023): the file is staged on PicPony with
 * its progress shown, then handed to Derpibooru by URL through the relay. Everything the form
 * asks is said on the field it belongs to; the four content ratings are one required choice;
 * three tags are the floor, the rating counted, as the original page warned.
 *
 * The draft and an upload in flight outlive the screen (`uploadStore.ts`): leaving keeps both,
 * an upload that lands while the screen is closed says so in a toast, and a reload or a closed
 * tab asks first — anywhere while an upload is in flight, here while the draft holds anything.
 *
 * **Nothing on it jumps** (M1-025, M1-026). The drop zone opens to a picked file's preview in one
 * move, the box reserved from the file's own size (`SizeSwap`); the progress row and the outcome
 * notice open and close by their own height; and a published result does not replace the form
 * under the reader's eyes — the page glides back to its top, and the form gives way to the result
 * there, the box closing to its size — rather than clamping the reader from the submit button to
 * the top in a frame.
 */
export default function UploadPage() {
  const { user, token, ready } = useSession();
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const { draft, job } = useUpload(token);
  const apiKey = typeof user?.api_key === 'string' && user.api_key.trim() ? user.api_key.trim() : null;
  const username = typeof user?.username === 'string' ? user.username : undefined;

  const [errors, setErrors] = useState<Errors>({});
  const [seenOutcome, setSeenOutcome] = useState<UploadOutcome | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const ratingRef = useRef<HTMLFieldSetElement>(null);
  const tagField = useRef<TagComboFieldHandle>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => attachUploadScreen(), []);

  const outcome = job?.outcome ?? null;
  const busy = job?.phase === 'staging' || job?.phase === 'submitting';
  /* A refusal's per-field complaints land on their fields, once per outcome; editing a field
     clears its own. During render, the documented pattern for state that follows a value. */
  if (outcome !== seenOutcome) {
    setSeenOutcome(outcome);
    if (outcome?.kind === 'rejected') {
      setErrors((previous) => ({
        ...previous,
        file: outcome.fields.image ?? previous.file,
        tags: outcome.fields.tags ?? previous.tags,
        source: outcome.fields.source ?? previous.source,
        description: outcome.fields.description ?? previous.description,
      }));
    }
  }

  /* **A result lands in two steps.** The store lets the draft go the moment Derpibooru answers;
     the form keeps showing it — its fields still unavailable and the button still busy, so focus
     stays on it — while the page glides back to its top, and only then gives way to the result.
     A result already there when the screen mounts (it landed while the screen was closed) is
     simply shown. */
  const uploaded = outcome?.kind === 'uploaded' ? outcome.imageId : null;
  const [landed, setLanded] = useState(uploaded !== null);
  const [seenUploaded, setSeenUploaded] = useState(uploaded);
  if (uploaded !== seenUploaded) {
    setSeenUploaded(uploaded);
    if (uploaded === null) setLanded(false);
  }
  const landing = uploaded !== null && !landed;
  const showResult = uploaded !== null && landed;
  /* The draft the form shows: the store's, but the submitted one while its result lands. */
  const [heldDraft, setHeldDraft] = useState(draft);
  if (!landing && heldDraft !== draft) setHeldDraft(draft);
  const formDraft = landing ? heldDraft : draft;

  useEffect(() => {
    if (!landing) return;
    const scroller = getAppScroller();
    let frame = 0;
    let quiet = 0;
    let last = Number.NaN;
    const started = performance.now();
    const land = () => setLanded(true);
    /* Back to the top first (the glide, or a jump under 关闭), then the result: done when the
       scroller is there, when the reader took the scroll over and it has stopped, or at the cap. */
    const watch = () => {
      const top = scroller?.scrollTop ?? 0;
      quiet = Math.abs(top - last) < 0.5 ? quiet + 1 : 0;
      last = top;
      if (top <= 1 || quiet >= 3 || performance.now() - started > LANDING_GLIDE_CAP_MS) land();
      else frame = requestAnimationFrame(watch);
    };
    scrollAppToTop();
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [landing]);

  useEffect(() => {
    if (showResult) doneRef.current?.focus({ preventScroll: true });
  }, [showResult]);

  /* **继续发布 takes the result away with the button that was pressed**: the form returns, and its
     first control — the drop zone — takes the focus in the commit that swaps them, before the
     frame (NEW-2: it fell to the document and stayed there). Only a focus the swap left nowhere
     moves; one already somewhere live is kept. */
  const resultShown = useRef(showResult);
  useLayoutEffect(() => {
    const was = resultShown.current;
    resultShown.current = showResult;
    if (!was || showResult) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    zoneRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [showResult]);

  /* One object URL per file, measured before it is shown, revoked when its preview goes. */
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    const file = formDraft.file;
    if (!file) return;
    const url = URL.createObjectURL(file);
    let current = true;
    void measureMedia(file, url).then((size) => {
      if (current) setPreview({ file, url, size });
      else URL.revokeObjectURL(url);
    });
    return () => {
      current = false;
    };
  }, [formDraft.file]);
  useEffect(() => {
    if (!preview) return;
    const { url } = preview;
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  if (!formDraft.file && preview) setPreview(null);

  /* While a new file is read the zone keeps what it showed — for the 200ms a picture usually takes,
     a placeholder would be one more jump — and says it is reading only past that. */
  const readingFile = formDraft.file && preview?.file !== formDraft.file ? formDraft.file : null;
  const [slowFile, setSlowFile] = useState<File | null>(null);
  useEffect(() => {
    if (!readingFile) return;
    const timer = window.setTimeout(() => setSlowFile(readingFile), READING_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [readingFile]);
  const zone: 'prompt' | 'reading' | 'preview' = !formDraft.file
    ? 'prompt'
    : !readingFile
      ? 'preview'
      : slowFile === readingFile
        ? 'reading'
        : preview
          ? 'preview'
          : 'prompt';

  /* The progress row and the notice hold what they showed while they close. */
  const showBusy = busy || landing;
  const [rowJob, setRowJob] = useState<UploadJob | null>(null);
  if (busy && job !== rowJob) setRowJob(job);
  const noticeOutcome = outcome && outcome.kind !== 'uploaded' && !landing ? outcome : null;
  const [notice, setNotice] = useState<{ outcome: NoticeOutcome; seq: number } | null>(null);
  if (noticeOutcome && noticeOutcome !== notice?.outcome) setNotice({ outcome: noticeOutcome, seq: (notice?.seq ?? 0) + 1 });

  const chosen = useMemo(
    () => new Set(formDraft.rating ? [...formDraft.tags, formDraft.rating] : formDraft.tags),
    [formDraft.tags, formDraft.rating],
  );

  const edit = (patch: Partial<UploadDraft>, fields: (keyof Errors)[]) => {
    if (!token) return;
    updateDraft(token, patch);
    clearOutcome(token);
    if (fields.some((field) => errors[field])) {
      setErrors((previous) => {
        const next = { ...previous };
        for (const field of fields) delete next[field];
        return next;
      });
    }
  };

  const pickFile = (file: File) => {
    const problem = fileProblem(file);
    if (problem) {
      setErrors((previous) => ({ ...previous, file: problem }));
      return;
    }
    edit({ file }, ['file']);
  };

  /** Tags typed or picked: a rating goes to the rating choice, the rest to the list. */
  const addTags = (incoming: string[]) => {
    let rating = draft.rating;
    const list = [...draft.tags];
    for (const tag of incoming) {
      if (RATINGS.has(tag)) rating = tag as RatingTag;
      else if (!list.includes(tag)) list.push(tag);
    }
    edit({ rating, tags: list }, rating !== draft.rating ? ['tags', 'rating'] : ['tags']);
  };

  const toggleTag = (tag: string) => {
    if (draft.tags.includes(tag)) edit({ tags: draft.tags.filter((item) => item !== tag) }, ['tags']);
    else addTags([tag]);
  };

  const submit = async () => {
    if (!token || !apiKey || busy || landing) return;
    const found = validate(draft);
    setErrors(found);
    if (found.file) {
      zoneRef.current?.querySelector('button')?.focus();
      return;
    }
    if (found.rating) {
      ratingRef.current?.querySelector('input')?.focus();
      return;
    }
    if (found.tags) {
      tagField.current?.focus();
      return;
    }
    if (found.source) {
      sourceRef.current?.focus();
      return;
    }
    if (found.description) {
      descriptionRef.current?.focus();
      return;
    }
    /* Focus waits on the busy button, which keeps it (a disabled field would drop it). */
    submitRef.current?.focus();
    if (!(await confirm({
      title: '确认发布',
      message:
        '作品会以你的 Derpibooru 账号直接提交到 Derpibooru。请确认你拥有作品的版权或授权、分级与标签准确，并且 Derpibooru 上还没有这张图片。多次违反上传规则可能导致 Derpibooru 账户被封禁。\n确定要发布吗？',
      tone: 'filled',
    }))) return;
    if (readToken() !== token) return;
    const tagInput = uploadTagInput(draft.rating, draft.tags);
    void startUpload({
      owner: token,
      apiKey,
      username,
      tagInput,
      navigate: (href) => router.push(href, { scroll: false }),
    });
  };

  const signedIn = ready && Boolean(token);
  const header = (
    <PageHeader
      title="发布图片"
      subtitle={signedIn && apiKey ? '作品会以你的 Derpibooru 账号直接提交到 Derpibooru' : undefined}
    />
  );

  let body;
  if (!ready) {
    body = <UploadSkeleton />;
  } else if (!token) {
    body = <SignInRequired description="登录后即可把作品发布到 Derpibooru。" />;
  } else if (!apiKey) {
    body = (
      <EmptyState
        icon={<MdKey size={ICON.display} />}
        title="需要绑定 API Key"
        description="发布作品需要绑定 Derpibooru API Key，作品会以对应的 Derpibooru 账号发布。"
        action={
          <Link scroll={false} href={settingsHref('account')} className={buttonClasses({ variant: 'filled' })}>
            <MdSettings aria-hidden="true" />
            前往设置
          </Link>
        }
      />
    );
  } else {
    const staging = job?.phase === 'staging';
    const content = showResult ? (
      <section aria-labelledby="upload-done" className="rounded-md bg-success-container p-8 text-center text-on-success-container">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success-fill text-on-fill" aria-hidden="true">
          <MdCheck size={ICON.large} />
        </span>
        <h2 id="upload-done" ref={doneRef} tabIndex={-1} className="mb-2 text-title-l focus-visible:outline-hidden">
          发布成功
        </h2>
        <p className="text-body-m">
          图片 ID：<span className="text-body-m-emphasized font-mono">{uploaded}</span>
        </p>
        <p className="mb-6 mt-1 text-body-s">Derpibooru 处理完成后作品即会上架；不符合上传规则的作品不会上架。</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link scroll={false} href={`/pic/${uploaded}`} className={buttonClasses({ variant: 'filled' })}>
            查看图片
          </Link>
          <Button variant="tonal" onClick={() => resetUpload(token)}>
            继续发布
          </Button>
        </div>
      </section>
    ) : (
      <div>
        <div ref={zoneRef}>
          <DropZone
            size="lg"
            disabled={showBusy}
            accept={UPLOAD_ACCEPT}
            onFile={pickFile}
            onReject={() => setErrors((previous) => ({
              ...previous,
              file: '不支持这种文件格式，请选择 PNG / JPG / GIF / WebP 图片或 WebM / MP4 视频',
            }))}
            filled={zone !== 'prompt'}
            aria-label={zone !== 'prompt' ? '更换文件' : '选择或拖拽要发布的图片或视频'}
          >
            <SizeSwap contentKey={zone === 'preview' && preview ? `preview:${preview.url}` : zone} className="w-full">
              {zone !== 'prompt' && formDraft.file ? (
                <FilePreview
                  file={zone === 'preview' && preview ? preview.file : formDraft.file}
                  preview={zone === 'preview' ? preview : null}
                  disabled={showBusy}
                  onRemove={() => edit({ file: null }, ['file'])}
                />
              ) : (
                <div>
                  <MdCloudUpload size={ICON.display} className="mx-auto mb-4 text-on-surface-variant" aria-hidden="true" />
                  <p className="mb-1 text-body-l-emphasized text-on-surface">点击选择或拖拽文件到此处</p>
                  <p className="text-body-m text-on-surface-variant">支持 PNG / JPG / GIF / WebP / WebM / MP4，最大 50 MB</p>
                </div>
              )}
            </SizeSwap>
          </DropZone>
          {errors.file && (
            <p role="alert" className="mt-1.5 px-4 text-body-s text-error">
              {errors.file}
            </p>
          )}
        </div>

        <form
          noValidate
          className="mt-6 space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset ref={ratingRef} aria-describedby={errors.rating ? 'upload-rating-error' : undefined}>
            <legend className="mb-1 text-label-l text-on-surface">
              分级 <span className="text-on-surface-variant">（必选）</span>
            </legend>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              {RATING_TAGS.map((rating) => (
                <Radio
                  key={rating.tag}
                  name="upload-rating"
                  value={rating.tag}
                  checked={formDraft.rating === rating.tag}
                  disabled={showBusy}
                  onChange={() => edit({ rating: rating.tag }, ['rating', 'tags'])}
                  label={
                    <span>
                      {rating.label} <span className="text-on-surface-variant">{rating.tag}</span>
                    </span>
                  }
                />
              ))}
            </div>
            {errors.rating && (
              <p id="upload-rating-error" role="alert" className="mt-1 px-4 text-body-s text-error">
                {errors.rating}
              </p>
            )}
          </fieldset>

          <div className="space-y-4">
            <TagComboField
              ref={tagField}
              label="添加标签"
              placeholder="搜索或输入标签，回车添加"
              chosen={chosen}
              onAdd={addTags}
              disabled={showBusy}
              error={errors.tags}
              helper={`至少 ${MIN_UPLOAD_TAGS} 个标签（含分级）；支持中文名称搜索，多个标签用逗号分隔`}
            />
            <TagWell
              level={2}
              title="已添加的标签"
              tags={formDraft.tags}
              onRemove={(tag) => edit({ tags: draft.tags.filter((item) => item !== tag) }, ['tags'])}
              empty="还没有添加标签"
              disabled={showBusy}
            />
            <UploadQuickTags chosen={chosen} onToggle={toggleTag} disabled={showBusy} />
          </div>

          <Input
            ref={sourceRef}
            type="url"
            label="来源链接"
            value={formDraft.source}
            disabled={showBusy}
            error={errors.source}
            helper="选填。作品首次发布的地址，例如画师的个人主页"
            placeholder="https://"
            onChange={(event) => edit({ source: event.target.value }, ['source'])}
          />

          <Textarea
            ref={descriptionRef}
            label="作品描述"
            value={formDraft.description}
            disabled={showBusy}
            error={errors.description}
            helper="选填"
            rows={3}
            placeholder="简单介绍这件作品"
            onChange={(event) => edit({ description: event.target.value }, ['description'])}
          />

          <div>
            {/* The phase in words, for a screen reader: a region that is always there and whose
                sentence changes is what gets said (the row's own text would announce every
                percent, or nothing at all as it opened). */}
            <p role="status" className="sr-only">
              {busy ? (staging ? '正在上传文件' : '正在提交到 Derpibooru，请稍候') : ''}
            </p>
            <Collapse open={noticeOutcome !== null}>
              {notice && (
                <div className="pb-6">
                  <OutcomeNotice key={notice.seq} outcome={notice.outcome} live={noticeOutcome !== null} />
                </div>
              )}
            </Collapse>
            <Collapse open={showBusy}>
              {rowJob && (
                <div className="pb-6">
                  <ProgressRow
                    job={rowJob}
                    onCancel={() => {
                      /* Focus waits on the submit button: this one leaves with its row. */
                      submitRef.current?.focus({ preventScroll: true });
                      cancelUpload(token);
                    }}
                  />
                </div>
              )}
            </Collapse>
            <p className="text-body-s text-on-surface-variant">
              发布即表示你拥有作品的版权或授权，并遵守{' '}
              <a href={DERPI_RULES} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-2">
                Derpibooru 上传规则
                <MdOpenInNew size={ICON.dense} className="ml-0.5 inline align-[-0.125em]" aria-hidden="true" />
              </a>
              。Derpibooru 上已有的图片不能重复上传。
            </p>
            <Button
              ref={submitRef}
              type="submit"
              variant="filled"
              size="lg"
              fullWidth
              loading={showBusy}
              icon={<MdCloudUpload />}
              className="mt-6"
            >
              确认发布
            </Button>
          </div>
        </form>
      </div>
    );
    /* The form and its result are one box that changes what it shows (`SizeSwap`). The result is
       a screen shorter than the form, so the page's end — the footer — comes up into view as the
       box closes: it rises from the bottom of the screen to its floor on the slow effects
       response, rather than crossing into view in a frame. */
    body = (
      <SizeSwap contentKey={showResult ? 'result' : 'form'} shrink="slowEffects" endsPage>
        {content}
      </SizeSwap>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {header}
      {body}
      {confirmDialog}
    </div>
  );
}
