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

       `no-motion:` on the hover *end state* only. The named
       `transition-transform` is in the off tier's block in globals.css, which
       re-declares `transition-property` with `!important` — so a transition-none
       utility beside it never won and was dropped. What the global rule cannot reach
       is the rotation the hover leaves behind, which is what
       `no-motion:group-hover:rotate-0` is for. `IconButton dismiss` and
       `Pagination` carry the same one-attribute form. */
    <Button
      variant="accent"
      className="group"
      onClick={onClick}
      loading={loading}
      icon={
        <MdRefresh
          /* No `size`: `Button` sizes its own icon slot now (20dp at this step,
             `ButtonSmallTokens.IconSize`). It passed `ICON.dense` (18), which is the
             chip/metadata size — one glyph, two opinions. */
          className="transition-transform duration-standard ease-[var(--ease-standard)] group-hover:rotate-180 no-motion:group-hover:rotate-0"
        />
      }
      data-ripple
    >
      {label}
    </Button>
  );
}
