'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { MdOutlineFeedback } from 'react-icons/md';
import Button from '@/components/Button';
import { showToast } from '@/components/Toast';
import { apiErrorMessage } from '@/lib/api/errors';
import { submitSemanticFeedback } from '@/lib/api/semantic';
import { readToken } from '@/lib/hooks';

/**
 * The slider captcha, the same challenge as sign-in: behind `dynamic()` and a one-way "has
 * ever opened" latch, so a search that is never reported never fetches it, and the element
 * stays mounted once shown for its exit animation. `loading` keeps the suspension on the dialog
 * rather than the route.
 */
const CaptchaModal = dynamic(() => import('@/components/CaptchaModal'), { ssr: false, loading: () => null });

/** Queries reported in this session, so coming back to one does not offer the button again. */
const reported = new Set<string>();

/**
 * 反馈本次搜索结果 — under a search whose words a model turned into tags. It sends the words and
 * what the model made of them (never what the user then kept) to the administrators' archive,
 * behind the sign-in captcha. The original front end asked the backend a second time whether a
 * model had been involved; the parse's own answer already says so, so this asks nothing extra.
 */
export default function SemanticFeedback({
  query,
  tags,
  engines,
}: {
  query: string;
  tags: readonly string[];
  engines: readonly string[];
}) {
  const [sentFor, setSentFor] = useState<string | null>(() => (reported.has(query) ? query : null));
  const [captchaMounted, setCaptchaMounted] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const sent = sentFor === query || reported.has(query);

  const openCaptcha = () => {
    setCaptchaMounted(true);
    setCaptchaOpen(true);
  };

  const send = async (cfToken: string) => {
    setCaptchaOpen(false);
    setSending(true);
    try {
      await submitSemanticFeedback({ query, tags, engines, cfToken }, readToken());
      reported.add(query);
      setSentFor(query);
      showToast('已提交反馈，感谢帮助改进中文搜索', 'success');
    } catch (error) {
      showToast(apiErrorMessage(error, '反馈提交失败，请稍后再试'), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-12 flex flex-col items-center gap-1 text-center">
      <Button
        variant="text"
        icon={<MdOutlineFeedback />}
        onClick={openCaptcha}
        loading={sending}
        disabled={sent}
      >
        {sent ? '已反馈' : '反馈本次搜索结果'}
      </Button>
      <p className="text-body-s text-on-surface-variant">
        {sent ? '管理员会查看这次中文搜索的转换结果。' : '这次中文搜索的结果不准确？提交给管理员查看。'}
      </p>
      {captchaMounted && (
        <CaptchaModal isOpen={captchaOpen} onClose={() => setCaptchaOpen(false)} onVerify={send} />
      )}
    </div>
  );
}
