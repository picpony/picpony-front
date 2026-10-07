import type { PonyChoice } from '@/lib/api/desktopPonies';
import { PONY_PREVIEWS } from './previewCatalog';

export const PONY_PAGE_SIZE = 8;
const FEATURED_PATHS = ['twilight sparkle', 'rainbow dash', 'fluttershy', 'pinkie pie', 'rarity', 'applejack', 'princess luna', 'princess celestia'];

export function ponyPreview(pony: PonyChoice): string | null {
  return PONY_PREVIEWS[pony.path.toLowerCase()] ?? null;
}
export function ponyNameParts(name: string): { name: string; variant: string } {
  const match = /^(.*?)\s*[（(]([^（）()]+)[）)]$/.exec(name);
  return match ? { name: match[1].trim(), variant: match[2].trim() } : { name, variant: '' };
}
export function filterPonies(ponies: readonly PonyChoice[], query: string, onlySelected: boolean, selected: readonly string[]): PonyChoice[] {
  const terms = query.trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  const rank = (path: string) => {
    const index = FEATURED_PATHS.indexOf(path.toLowerCase());
    return index === -1 ? FEATURED_PATHS.length : index;
  };
  return ponies.filter(pony => (!onlySelected || selected.includes(pony.name)) && terms.every(term => `${pony.name} ${pony.path}`.toLocaleLowerCase('en-US').includes(term)))
    .sort((a, b) => rank(a.path) - rank(b.path));
}
export function samePonySelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(name => b.includes(name));
}
