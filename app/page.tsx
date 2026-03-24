import { Suspense } from "react";
import FadeInImage from "@/components/FadeInImage";

interface ImageRepresentation {
  full: string;
  small: string;
  thumb_tiny: string;
  thumb_small: string;
  thumb: string;
  medium: string;
  large: string;
  tall: string;
}

export interface PonyImage {
  id: number;
  width: number;
  height: number;
  aspect_ratio: number;
  representations: ImageRepresentation;
  name: string;
  view_url: string;
}

interface ApiResponse {
  total: number;
  images: PonyImage[];
}

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

async function getImages(): Promise<ApiResponse> {
  const res = await fetch(
    "https://derpibooru.org/api/v1/json/search/images?q=-explicit%2C%20-questionable%2C%20-suggestive%2C%20-grotesque%2C%20-grimdark%2C%20-spoiler%2C%20pony&page=1&per_page=50&sf=created_at&sd=desc",
    { 
      cache: 'no-store',
      headers: {
        'User-Agent': 'PicPony/1.0'
      }
    }
  );

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'No error text');
    console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
    throw new Error(`Failed to fetch images: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function ImageList() {
  const data = await getImages();

  return (
    <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4 animate-fade-in">
      {data.images.map((image) => (
        <div key={image.id} className="break-inside-avoid">
          <a 
            href={`https://trixiebooru.org/${image.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block relative rounded-lg overflow-hidden group bg-slate-100"
          >
            <FadeInImage
              src={image.representations.thumb}
              alt={image.name || `Image ${image.id}`}
              width={image.width}
              height={image.height}
              className="w-full h-auto object-cover transition-all duration-500"
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
          </a>
        </div>
      ))}
    </div>
  );
}

function ImageSkeleton() {
  return (
    <div className="flex justify-center items-center min-h-[50vh]">
      <div className="w-8 h-8 border-[4px] border-transparent border-t-blue-300 rounded-full animate-[spin_0.5s_linear_infinite]"></div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Suspense fallback={<ImageSkeleton />}>
        <ImageList />
      </Suspense>
    </div>
  );
}
