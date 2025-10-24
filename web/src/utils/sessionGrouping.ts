import type { SessionGrouping, TelemetrySession } from '../types';
import { UNKNOWN_IP_LABEL, resolveSessionIp } from './session';

export const UNKNOWN_GROUP_VALUE = '__UNKNOWN__';

export function normalizeGroupingCandidate(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveSessionGroupingValue(
  session: TelemetrySession,
  grouping: SessionGrouping
): string {
  switch (grouping) {
    case 'ip': {
      const ip = resolveSessionIp(session);
      return !ip || ip === UNKNOWN_IP_LABEL ? UNKNOWN_GROUP_VALUE : ip;
    }
    case 'account': {
      const account = normalizeGroupingCandidate(session.client?.['accountName']);
      if (account) return account;
      const userName = normalizeGroupingCandidate(session.client?.['userName']);
      return userName || UNKNOWN_GROUP_VALUE;
    }
    case 'device': {
      const device = normalizeGroupingCandidate(session.client?.['deviceName']);
      return device || UNKNOWN_GROUP_VALUE;
    }
    case 'product': {
      const product = normalizeGroupingCandidate(session.client?.['productName']);
      return product || UNKNOWN_GROUP_VALUE;
    }
    case 'platform': {
      const platform = normalizeGroupingCandidate(session.client?.['platform']);
      return platform || UNKNOWN_GROUP_VALUE;
    }
    default:
      return UNKNOWN_GROUP_VALUE;
  }
}

interface GroupingMeta {
  label: string;
  allLabel: string;
  unknownLabel: string;
  optionLabel: string;
}

export const SESSION_GROUPING_DISPLAY_META: Record<SessionGrouping, GroupingMeta> = {
  ip: {
    label: '游戏客户端 IP',
    allLabel: '全部客户端',
    unknownLabel: UNKNOWN_IP_LABEL,
    optionLabel: '按 IP 地址',
  },
  account: {
    label: '游戏账号',
    allLabel: '全部账号',
    unknownLabel: '未知账号',
    optionLabel: '按账号',
  },
  device: {
    label: '设备名称',
    allLabel: '全部设备',
    unknownLabel: '未知设备',
    optionLabel: '按设备',
  },
  product: {
    label: '产品名称',
    allLabel: '全部产品',
    unknownLabel: '未知产品',
    optionLabel: '按产品',
  },
  platform: {
    label: '运行平台',
    allLabel: '全部平台',
    unknownLabel: '未知平台',
    optionLabel: '按平台',
  },
};

export const SESSION_GROUPINGS = Object.keys(
  SESSION_GROUPING_DISPLAY_META
) as SessionGrouping[];

export const SESSION_GROUPING_OPTIONS = SESSION_GROUPINGS.map((key) => ({
  label: SESSION_GROUPING_DISPLAY_META[key].optionLabel,
  value: key,
}));
