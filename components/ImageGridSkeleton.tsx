'use client';

export default function ImageGridSkeleton() {
  const skeletonHeights = [
    [280, 320, 240],
    [200, 380, 260],
    [340, 220, 300],
    [260, 280, 340],
  ];

  return (
    <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
      {skeletonHeights.map((colHeights, colIndex) => (
        <div
          key={colIndex}
          className={`flex flex-col gap-2 sm:gap-4 flex-1 min-w-0 ${
            colIndex === 2
              ? 'hidden md:flex'
              : colIndex === 3
                ? 'hidden lg:flex'
                : colIndex >= 2
                  ? 'hidden'
                  : 'flex'
          }`}
        >
          {colHeights.map((height, i) => (
            <div
              key={i}
              className="w-full bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse"
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
