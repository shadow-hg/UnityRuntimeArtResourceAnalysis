import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { Button, Card, Space } from 'antd';
import type { CardProps } from 'antd';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

export interface CollapsibleCardProps extends CardProps {
  title: ReactNode;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

export default function CollapsibleCard({
  title,
  defaultCollapsed = false,
  collapsible = true,
  onCollapseChange,
  extra,
  bodyStyle,
  headStyle,
  children,
  ...cardProps
}: CollapsibleCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const handleToggle = useCallback(() => {
    if (!collapsible) {
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      onCollapseChange?.(next);
      return next;
    });
  }, [collapsible, onCollapseChange]);

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
    const hasControls = Boolean(extra) || Boolean(collapseButton);

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: hasControls ? 'minmax(0, 1fr) auto' : '1fr',
          alignItems: 'center',
          gap: 12,
          width: '100%',
        }}
      >
        <div style={{ minWidth: 0 }}>{title}</div>
        {hasControls ? (
          <div
            style={{
              justifySelf: 'end',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            <Space
              size={8}
              wrap
              align="center"
              style={{ display: 'flex', justifyContent: 'flex-end' }}
            >
              {extra}
              {collapseButton}
            </Space>
          </div>
        ) : null}
      </div>
    );
  }, [title, extra, collapseButton]);

  return (
    <Card
      {...cardProps}
      title={header}
      extra={undefined}
      headStyle={headStyle}
      bodyStyle={collapsed ? { ...(bodyStyle ?? {}), padding: 0 } : bodyStyle}
    >
      {collapsed ? null : children}
    </Card>
  );
}
