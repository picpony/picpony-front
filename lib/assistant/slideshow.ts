export interface AssistantSlideshowRequest { token: string; folderId: number; page: number }
export interface AssistantSlideshowReceipt { count: number; folderId: number; page: number; totalPages: number; withheld: number }
type Handler = (request: AssistantSlideshowRequest) => Promise<AssistantSlideshowReceipt>;
let handler: Handler | null = null;

export function bindAssistantSlideshow(next: Handler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}
export function requestAssistantSlideshow(request: AssistantSlideshowRequest): Promise<AssistantSlideshowReceipt> {
  if (!handler) return Promise.reject(new Error('收藏夹放映暂不可用，请稍后再试'));
  return handler(request);
}
