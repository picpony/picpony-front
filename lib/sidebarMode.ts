/** Desktop navigation states; the phone's modal drawer is independent.
 * See docs/design/layout.md#navigation-geometry. */
export type SidebarMode = 'expanded' | 'icons' | 'hidden';

/** Keep the existing device keys and accept their previous boolean values. */
export function parseSidebarMode(value: string | null | undefined): SidebarMode {
  if (value === 'icons') return 'icons';
  if (value === 'hidden' || value === 'true') return 'hidden';
  return 'expanded';
}
