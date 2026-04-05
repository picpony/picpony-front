'use client';

import React from 'react';
import BBCode from '@bbob/react';
import presetReact from '@bbob/preset-react';

interface BBCodeRendererProps {
  content: string;
}

export default function BBCodeRenderer({ content }: BBCodeRendererProps) {
  return (
    <div className="bbcode-content">
      <BBCode plugins={[presetReact()]}>
        {content}
      </BBCode>
    </div>
  );
}
