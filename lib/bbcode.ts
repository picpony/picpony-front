export function escapeHTML(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function htmlToBBCode(html: string | null | undefined): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }

  const div = document.createElement('div');
  div.innerHTML = html;

  function traverse(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    let content = '';
    node.childNodes.forEach(child => {
      content += traverse(child);
    });

    const el = node as HTMLElement;
    const style = el.getAttribute('style') || '';
    const tag = node.nodeName.toLowerCase();

    switch (tag) {
      case 'p':
        return content + '\n';
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `[b]${content}[/b]`;
      case 'em':
      case 'i':
        return `[i]${content}[/i]`;
      case 'u':
        return `[u]${content}[/u]`;
      case 'strike':
      case 's':
        return `[s]${content}[/s]`;
      case 'span':
        if (style.includes('color:')) {
          const colorMatch = style.match(/color:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|[a-zA-Z]+)/);
          if (colorMatch) return `[color=${colorMatch[1]}]${content}[/color]`;
        }
        return content;
      case 'div':
        if (style.includes('text-align: center')) return `[center]${content}[/center]\n`;
        return content + '\n';
      case 'img':
        return `[img]${el.getAttribute('src')}[/img]`;
      case 'li':
        return `[*] ${content}\n`;
      case 'ul':
        return `[list]\n${content}[/list]\n`;
      case 'ol':
        return `[list=1]\n${content}[/list]\n`;
      case 'blockquote':
        return `[quote]${content}[/quote]\n`;
      case 'pre':
        return `[code]${content}[/code]\n`;
      case 'a':
        return `[url=${el.getAttribute('href')}]${content}[/url]`;
      default:
        return content;
    }
  }

  return traverse(div).trim().replace(/\n{3,}/g, '\n\n');
}

export function bbcodeToHtml(bbcode: string | null | undefined): string {
  if (!bbcode) return '<p><br></p>';

  let html = escapeHTML(bbcode);

  html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" style="max-width:100%;" />');
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span style="text-decoration:underline;">$1</span>');
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<strike>$1</strike>');
  html = html.replace(
    /\[color=(.*?)\]([\s\S]*?)\[\/color\]/gi,
    '<span style="color:$1;">$2</span>'
  );
  html = html.replace(
    /\[center\]([\s\S]*?)\[\/center\]/gi,
    '<div style="text-align:center;">$1</div>'
  );
  html = html.replace(
    /\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi,
    '<a href="$1" target="_blank">$2</a>'
  );
  html = html.replace(
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    '<blockquote>$1</blockquote>'
  );
  html = html.replace(
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    '<pre><code>$1</code></pre>'
  );
  html = html.replace(
    /\[list\]([\s\S]*?)\[\/list\]/gi,
    '<ul>$1</ul>'
  );
  html = html.replace(
    /\[list=1\]([\s\S]*?)\[\/list\]/gi,
    '<ol>$1</ol>'
  );
  html = html.replace(/\[\*\] /gi, '<li>');
  html = html.replace(/\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|$)/gi, '<li>$1</li>');

  const paragraphs = html.split('\n').filter(line => line.trim() !== '');
  if (paragraphs.length === 0) return '<p><br></p>';

  return `<p>${paragraphs.join('</p><p>')}</p>`;
}
