const API_BASE = 'https://picpony.top';

export function getAvatarUrl(avatar: string | undefined | null): string {
  if (!avatar) return '';
  if (avatar.startsWith('http')) return avatar;
  return `${API_BASE}/${avatar}`;
}

export function getAssetUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_BASE}/${path}`;
}

export function formatDate(date: string | Date, locale: string = 'zh-CN'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function processImageFile(file: File, maxSizeMB: number = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择有效的图片文件'));
      return;
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
      reject(new Error(`图片大小不能超过 ${maxSizeMB}MB`));
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error('读取图片失败'));
    };
    reader.readAsDataURL(file);
  });
}

export function distributeToMasonryColumns<T extends { height?: number; width?: number }>(
  items: T[],
  columns: number
): T[][] {
  const columnData: T[][] = Array.from({ length: columns }, () => []);
  const columnHeights = new Array(columns).fill(0);

  items.forEach((item) => {
    let shortestColIndex = 0;
    let minHeight = columnHeights[0];
    for (let i = 1; i < columns; i++) {
      if (columnHeights[i] < minHeight) {
        minHeight = columnHeights[i];
        shortestColIndex = i;
      }
    }

    columnData[shortestColIndex].push(item);
    const aspectRatio = (item.height || 1) / (item.width || 1);
    columnHeights[shortestColIndex] += aspectRatio;
  });

  return columnData;
}
