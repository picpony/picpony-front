import type { ComponentType } from 'react';
import {
  MdAltRoute,
  MdAnalytics,
  MdAnimation,
  MdAutoAwesome,
  MdBlock,
  MdBook,
  MdCampaign,
  MdDashboard,
  MdDeveloperMode,
  MdEmojiEvents,
  MdGroups,
  MdManageSearch,
  MdMessage,
  MdNotifications,
  MdPeople,
  MdPets,
  MdReport,
  MdRouter,
  MdShield,
  MdSpeed,
  MdStorage,
  MdStore,
  MdToll,
  MdTune,
} from 'react-icons/md';

/**
 * Each console section's name and mark — the one source the rail (`registry.tsx`) and the panel's
 * own heading (`SectionHeader section=…`) both read, so a tab and the page it opens name one thing
 * one way. Written twice, five had drifted apart (G4-010: 团队管理 opened 运营团队, 开发者 opened
 * 开发者模式, 屏蔽图库 opened 图片屏蔽库), and ten headings carried a glyph other than their tab's.
 *
 * A label is a rail label first: short, and in the rail's 「…管理」 pattern where the section is
 * the management of one thing.
 */
export const ADMIN_SECTIONS = {
  welcome: { label: '概览', glyph: MdDashboard },
  glossary: { label: '词库编辑', glyph: MdBook },
  users: { label: '用户管理', glyph: MdPeople },
  notifications: { label: '通知管理', glyph: MdNotifications },
  announcement: { label: '公告管理', glyph: MdCampaign },
  messages: { label: '私信审计', glyph: MdMessage },
  badges: { label: '徽章管理', glyph: MdEmojiEvents },
  blocktags: { label: '屏蔽标签', glyph: MdShield },
  developer: { label: '开发者模式', glyph: MdDeveloperMode },
  team: { label: '团队管理', glyph: MdGroups },
  shop: { label: '商店管理', glyph: MdStore },
  mascots: { label: '吉祥物管理', glyph: MdPets },
  ponies: { label: '桌面小马', glyph: MdAnimation },
  'data-import': { label: '数据导入', glyph: MdStorage },
  reports: { label: '举报处理', glyph: MdReport },
  blacklist: { label: '图片屏蔽库', glyph: MdBlock },
  wealth: { label: '经验与金币', glyph: MdToll },
  other: { label: '其他功能', glyph: MdTune },
  routes: { label: '全站线路', glyph: MdAltRoute },
  statistics: { label: '访问统计', glyph: MdAnalytics },
  semantic: { label: '智能搜索', glyph: MdManageSearch },
  relay: { label: '中转服务', glyph: MdRouter },
  'rate-management': { label: '频率与临时封禁', glyph: MdSpeed },
  'ai-assistant': { label: '彩彩 AI', glyph: MdAutoAwesome },
} as const satisfies Record<string, { label: string; glyph: ComponentType<{ size?: number }> }>;

export type AdminSectionId = keyof typeof ADMIN_SECTIONS;
