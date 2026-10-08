'use client';
import { defineResource } from '@/lib/resource';
import { getAssistantQuota, getAssistantPermission } from '@/lib/api/assistant';
import type { AssistantQuota, PermissionMode } from './protocol';

export const assistantQuota = defineResource<{ token: string }, AssistantQuota>({
  name: 'assistant-quota', key: ({ token }) => token, fetch: ({ token }, signal) => getAssistantQuota(token, signal), ttl: 30_000, maxEntries: 2,
});
export const assistantPermission = defineResource<{ token: string }, PermissionMode>({
  name: 'assistant-permission', key: ({ token }) => token, fetch: ({ token }, signal) => getAssistantPermission(token, signal), ttl: 30_000, maxEntries: 2,
});
