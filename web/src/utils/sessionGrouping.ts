import type { SessionGrouping } from '../types';
import { UNKNOWN_IP_LABEL } from './session';

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

export const SESSION_GROUPING_OPTIONS = (Object.keys(
  SESSION_GROUPING_DISPLAY_META
) as SessionGrouping[]).map((key) => ({
  label: SESSION_GROUPING_DISPLAY_META[key].optionLabel,
  value: key,
}));
