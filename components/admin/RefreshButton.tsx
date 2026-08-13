'use client';

import { MdRefresh } from 'react-icons/md';
import Button from '@/components/Button';

interface RefreshButtonProps {
  onClick: () => void;
  label?: string;
  loading?: boolean;
}

export default function RefreshButton({
  onClick,
  label = '刷新列表',
  loading = false,
}: RefreshButtonProps) {
  return (
    /* `loading`, not `disabled` plus a hand-spun glyph: the primitive already
       swaps the icon for a real `Spinner` and blocks interaction, which is what
       every other busy button in the console does. Doing it by hand here meant the
       spinner was a rotating `MdRefresh` in one place and a `Spinner` everywhere
       else, for the same state.

       `motion-reduce:` on the hover rotate, which the identical idiom in
       `Modal` and `AuthModal` already carries — the reduced-motion enumeration
       covers `animate-*` keyframes and (now) `transition-ui`, but a named
       `transition-transform` still needs its own opt-out. */
    <Button
      variant="accent"
      className="group"
      onClick={onClick}
      loading={loading}
      icon={
        <MdRefresh
          size={18}
          className="transition-transform duration-300 ease-[var(--ease-standard)] group-hover:rotate-180 motion-reduce:transition-none motion-reduce:group-hover:rotate-0"
        />
      }
      data-ripple
    >
      {label}
    </Button>
  );
}
