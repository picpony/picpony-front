'use client';

import React from 'react';
import BBCode from '@bbob/react';
import presetReact from '@bbob/preset-react';

interface BBCodeRendererProps {
  content: string;
}

export default function BBCodeRenderer({ content }: BBCodeRendererProps) {
  const processedContent = content.replace(/\[img\](\/[^\[\]]+)\[\/img\]/gi, '[img]https://picpony.top$1[/img]');

  return (
    <div className="bbcode-content">
      <BBCode 
        plugins={[presetReact()]}
        options={{
          onlyAllowTags: ['b', 'i', 'u', 's', 'url', 'img', 'quote', 'code', 'style', 'list', 'color', '*']
        }}
      >
        {processedContent}
      </BBCode>
    </div>
  );
}
