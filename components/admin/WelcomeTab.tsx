'use client';

import SectionHeading from '@/components/SectionHeading';

export default function WelcomeTab() {
  return (
    <div>
      <SectionHeading>欢迎来到管理面板</SectionHeading>
      <p className="text-body-m text-on-surface-variant mb-6">
        在这里您可以管理网站的各种设置和内容。请从左侧菜单选择要管理的功能模块。
      </p>
    </div>
  );
}
