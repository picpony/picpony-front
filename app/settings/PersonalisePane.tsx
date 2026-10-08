'use client';

import { ModeAndMotionSection, PaletteSection } from './AppearanceSection';
import MascotSettings from '@/components/mascot/MascotSettings';
import PoniesSettings from '@/components/desktopPonies/PoniesSettings';

/**
 * 个性化 (decision 23) — how the app looks and feels. A run of self-contained sections, each its
 * own heading and rows. Appearance and mascot device preferences work signed out; cloud sync
 * and desktop pony selection use the account when required.
 */
export default function PersonalisePane({ signedIn }: { signedIn: boolean }) {
  return (
    <div>
      <PaletteSection signedIn={signedIn} />
      <ModeAndMotionSection />
      <MascotSettings />
      <PoniesSettings />
    </div>
  );
}
