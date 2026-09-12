'use client';

import { useSyncExternalStore } from 'react';
import Modal from './Modal';
import SliderCaptcha from './SliderCaptcha';
import Button from './Button';

interface CaptchaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerify: (token: string) => void;
}

export default function CaptchaModal({ isOpen, onClose, onVerify }: CaptchaModalProps) {
  /* Renders null on the server and before hydration: the captcha needs browser
     APIs, and the Modal is client-only anyway. */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!mounted) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="fit" hideCloseButton title="安全验证"
      footer={<Button variant="tonal" onClick={onClose}>取消</Button>}
    >
      <SliderCaptcha onVerify={onVerify} active={isOpen} />
    </Modal>
  );
}
