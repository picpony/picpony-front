/**
 * Admin-local re-exports.
 *
 * `SearchInput` used to have a second, near-identical copy in this folder that
 * differed only in border token and had no surface fill; the shared one is the
 * survivor. `EmptyState` lived here as a `<tr>` with a `colSpan` — `DataTable`
 * owns the empty row now, and nothing else consumed it, so it is gone.
 */
export { default as Spinner } from '../Spinner';
export { default as SearchInput } from '../SearchInput';
export { default as RefreshButton } from './RefreshButton';
export { default as SectionHeader } from './SectionHeader';
