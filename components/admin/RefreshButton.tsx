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
       swaps the icon for a real `Spinner` and blocks interaction, which is
       what every other busy button in the console does.

       `no-motion:` guards the hover *end state* only: the off tier's globals
       block re-declares the transition property with `!important`, so a
       transition-suppressing utility beside it never won; what that rule
       cannot reach is the rotation the hover leaves behind. The
       one-attribute form is shared with the dismiss icon button and
       `Pagination`. */
    <Button
      variant="accent"
      className="group"
      onClick={onClick}
      loading={loading}
      icon={
        <MdRefresh
          /* No `size`: `Button` sizes its own icon slot (20dp at this step).
             Passing the 18dp chip/metadata size here was one glyph, two
             opinions. */
          className="transition-transform duration-standard ease-[var(--ease-standard)] group-hover:rotate-180 no-motion:group-hover:rotate-0"
        />
      }
    >
      {label}
    </Button>
  );
}
