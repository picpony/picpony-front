'use client';

import { useState, useEffect } from 'react';
import Modal from './Modal';
import SliderCaptcha from './SliderCaptcha';

interface CaptchaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerify: (token: string) => void;
}

export default function CaptchaModal({ isOpen, onClose, onVerify }: CaptchaModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-fit"
      hideCloseButton
    >
      <SliderCaptcha onVerify={onVerify} onClose={onClose} />
    </Modal>
  );
}
