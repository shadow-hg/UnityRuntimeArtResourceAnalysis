import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

export interface CollapsibleSectionProps {
  title: ReactNode;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  extra?: ReactNode;
  contentStyle?: CSSProperties;
  children?: ReactNode;
}

export default function CollapsibleSection({
  title,
  defaultCollapsed = false,
  collapsible = true,
  extra,
  contentStyle,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const handleToggle = useCallback(() => {
    if (!collapsible) {
      return;
    }
    setCollapsed((prev) => !prev);
  }, [collapsible]);

  const collapseButton = useMemo(() => {
    if (!collapsible) {
      return null;
    }

    return (
      <Button
        type="text"
        size="small"
        icon={collapsed ? <CaretDownOutlined /> : <CaretUpOutlined />}
        onClick={handleToggle}
      >
        {collapsed ? '展开' : '收起'}
      </Button>
    );
  }, [collapsible, collapsed, handleToggle]);

  const header = useMemo(() => {
    const hasExtra = Boolean(extra) || Boolean(collapseButton);
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: hasExtra ? 'minmax(0, 1fr) auto' : '1fr',
          alignItems: 'center',
          gap: 8,
          width: '100%',
        }}
      >
        <Typography.Title level={5} style={{ margin: 0, minWidth: 0 }}>
          {title}
        </Typography.Title>
        {hasExtra ? (
          <Space size={8} wrap style={{ justifyContent: 'flex-end', display: 'flex' }}>
            {extra}
            {collapseButton}
          </Space>
        ) : null}
      </div>
    );
  }, [title, extra, collapseButton]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {header}
      <div
        style={{
          overflow: 'hidden',
          transition: 'max-height 0.3s ease, opacity 0.2s ease',
          maxHeight: collapsed ? 0 : 9999,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
        }}
        aria-hidden={collapsed}
      >
        <div style={{ width: '100%', ...contentStyle }}>{children}</div>
      </div>
    </div>
  );
}
