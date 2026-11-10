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
  MdOutlineAnalytics,
  MdOutlineAnimation,
  MdOutlineAutoAwesome,
  MdOutlineBook,
  MdOutlineCampaign,
  MdOutlineDashboard,
  MdOutlineEmojiEvents,
  MdOutlineGroups,
  MdOutlineMessage,
  MdOutlineNotifications,
  MdOutlinePeople,
  MdOutlineReport,
  MdOutlineRouter,
  MdOutlineShield,
  MdOutlineSpeed,
  MdOutlineStore,
  MdPeople,
  MdPets,
  MdReport,
  MdRouter,
  MdShield,
  MdSpeed,
  MdStorage,
  MdStore,
  MdToll,
  MdTranslate,
  MdTune,
} from 'react-icons/md';

/** A section's mark, at the rail tab's own size — sized by the caller, not here. */
type Glyph = ComponentType<{ size?: number }>;

/**
 * Each console section's name and mark — the one source the rail (`registry.tsx`) and the panel's
 * own heading (`SectionHeader section=…`) both read, so a tab and the page it opens name one thing
 * one way. Written twice, five had drifted apart (G4-010: 团队管理 opened 运营团队, 开发者 opened
 * 开发者模式, 屏蔽图库 opened 图片屏蔽库), and ten headings carried a glyph other than their tab's.
 *
 * A label is a rail label first: short, and in the rail's 「…管理」 pattern where the section is
 * the management of one thing.
 *
 * `glyph` is the filled mark the heading shows. `outline` is the rail's rest state — the rail
 * swaps to `glyph` on the selected tab (the navigation-drawer rule in `docs/design/primitives.md`).
 * It is omitted wherever Material Icons draws the pair *identically* — 开发者模式, 吉祥物管理,
 * 数据维护, 图片屏蔽库, 经验与金币, 其他功能, 全站线路, 智能搜索, 文本翻译 — and there the
 * selected pill, the emphasized label and the ink carry the state alone, exactly as `SidebarNav`
 * does for its magnifier. Do not substitute a different concept to get a second weight: the
 * heading and the tab would stop naming one thing.
 */
export const ADMIN_SECTIONS = {
  welcome: { label: '概览', glyph: MdDashboard, outline: MdOutlineDashboard },
  glossary: { label: '词库编辑', glyph: MdBook, outline: MdOutlineBook },
  users: { label: '用户管理', glyph: MdPeople, outline: MdOutlinePeople },
  notifications: { label: '通知管理', glyph: MdNotifications, outline: MdOutlineNotifications },
  announcement: { label: '公告管理', glyph: MdCampaign, outline: MdOutlineCampaign },
  messages: { label: '私信审计', glyph: MdMessage, outline: MdOutlineMessage },
  badges: { label: '徽章管理', glyph: MdEmojiEvents, outline: MdOutlineEmojiEvents },
  blocktags: { label: '屏蔽标签', glyph: MdShield, outline: MdOutlineShield },
  developer: { label: '开发者模式', glyph: MdDeveloperMode },
  team: { label: '团队管理', glyph: MdGroups, outline: MdOutlineGroups },
  shop: { label: '商店管理', glyph: MdStore, outline: MdOutlineStore },
  mascots: { label: '吉祥物管理', glyph: MdPets },
  ponies: { label: '桌面小马', glyph: MdAnimation, outline: MdOutlineAnimation },
  'data-import': { label: '数据维护', glyph: MdStorage },
  reports: { label: '举报处理', glyph: MdReport, outline: MdOutlineReport },
  blacklist: { label: '图片屏蔽库', glyph: MdBlock },
  wealth: { label: '经验与金币', glyph: MdToll },
  other: { label: '其他功能', glyph: MdTune },
  routes: { label: '全站线路', glyph: MdAltRoute },
  statistics: { label: '访问统计', glyph: MdAnalytics, outline: MdOutlineAnalytics },
  semantic: { label: '智能搜索', glyph: MdManageSearch },
  'text-translation': { label: '文本翻译', glyph: MdTranslate },
  relay: { label: '中转服务', glyph: MdRouter, outline: MdOutlineRouter },
  'rate-management': { label: '频率与临时封禁', glyph: MdSpeed, outline: MdOutlineSpeed },
  'ai-assistant': { label: '彩彩 AI', glyph: MdAutoAwesome, outline: MdOutlineAutoAwesome },
} as const satisfies Record<string, { label: string; glyph: Glyph; outline?: Glyph }>;

export type AdminSectionId = keyof typeof ADMIN_SECTIONS;
