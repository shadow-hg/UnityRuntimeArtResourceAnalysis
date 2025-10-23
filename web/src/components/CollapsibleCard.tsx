import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { Button, Card, Flex } from 'antd';
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

  const control = useMemo(() => {
    if (!collapsible) {
      return extra ?? null;
    }

    return (
      <Flex align="center" gap={8}>
        {extra}
        <Button
          type="text"
          size="small"
          icon={collapsed ? <CaretDownOutlined /> : <CaretUpOutlined />}
          onClick={handleToggle}
        >
          {collapsed ? '展开' : '收起'}
        </Button>
      </Flex>
    );
  }, [collapsible, collapsed, extra, handleToggle]);

  return (
    <Card
      {...cardProps}
      title={title}
      extra={control}
      bodyStyle={collapsed ? { padding: 0 } : bodyStyle}
    >
      {collapsed ? null : children}
    </Card>
  );
}
