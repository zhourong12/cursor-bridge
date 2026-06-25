import { describe, expect, it, beforeEach } from 'vitest';
import { extractMentionsFromText } from './mention-extractor';
import {
  canSendBotMention,
  recordBotMention,
  resetBotLoopProtectionForTest,
} from './bot-loop-protection';
import type { FleetConfig } from '../fleet/schema';

const fleet: FleetConfig = {
  schemaVersion: 1,
  bots: {
    cursor: { profile: 'cursor', name: '画师', openId: 'ou_huashi' },
    'cursor-jishi': { profile: 'cursor-jishi', name: '基石', openId: 'ou_jishi' },
    cejiang: { profile: 'cejiang', name: '测匠', openId: 'ou_cejiang' },
  },
};

describe('extractMentionsFromText', () => {
  it('matches display name @基石', () => {
    const r = extractMentionsFromText('@基石 请简短确认收到', fleet);
    expect(r.at).toEqual([{ openId: 'ou_jishi', name: '基石' }]);
    expect(r.body).toBe('请简短确认收到');
  });

  it('ignores unknown @张三', () => {
    const r = extractMentionsFromText('@张三 你好 @基石 任务', fleet);
    expect(r.at).toEqual([{ openId: 'ou_jishi', name: '基石' }]);
  });

  it('skips self openId', () => {
    const r = extractMentionsFromText('@画师 自检', fleet, { selfOpenId: 'ou_huashi' });
    expect(r.at).toEqual([]);
  });
});

describe('bot-loop-protection', () => {
  beforeEach(() => resetBotLoopProtectionForTest());

  it('allows up to 5 turns then blocks', () => {
    const chat = 'oc_test';
    for (let i = 0; i < 5; i++) {
      expect(canSendBotMention(chat, 'ou_a', 'ou_b')).toBe(true);
      recordBotMention(chat, 'ou_a', 'ou_b');
    }
    expect(canSendBotMention(chat, 'ou_a', 'ou_b')).toBe(false);
  });
});
