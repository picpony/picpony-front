/**
 * No title here, on purpose: the page's `generateMetadata` names each search, and a plain string
 * title on this segment would have stopped the root layout's `%s - PicPony` template from
 * reaching it — the first document read 搜索：fluttershy while the screen, once it took over the
 * title, wrote 搜索：fluttershy - PicPony.
 */
export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
