'use server';

import fs from 'fs';
import path from 'path';

export async function getEmojis() {
  try {
    const emojiDir = path.join(process.cwd(), 'public', 'img', 'emoji');
    const files = fs.readdirSync(emojiDir);

    const emojis = files
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace('.png', ''));

    return emojis;
  } catch (error) {
    console.error('Failed to read emoji directory:', error);
    return [];
  }
}
