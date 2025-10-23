import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { Button, Card, Space, theme } from 'antd';
import type { CardProps } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

export interface CollapsibleCardProps extends CardProps {
  title: ReactNode;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  collapseMode?: 'hidden' | 'compact';
  onCollapseChange?: (collapsed: boolean) => void;
}

export default function CollapsibleCard({
  title,
  defaultCollapsed = false,
  collapsible = true,
  collapseMode = 'hidden',
  onCollapseChange,
  extra,
  bodyStyle,
  headStyle,
  children,
  ...cardProps
}: CollapsibleCardProps) {
  const { token } = theme.useToken();
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

  const { contentBodyStyle, wrapperStyle, cardBodyStyle } = useMemo(() => {
    if (collapseMode !== 'compact') {
      return {
        contentBodyStyle: undefined,
        wrapperStyle: undefined,
        cardBodyStyle: collapsed ? { ...(bodyStyle ?? {}), padding: 0 } : bodyStyle,
      };
    }

    const originalBodyStyle: CSSProperties = bodyStyle ? { ...bodyStyle } : {};
    const {
      padding,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      ...restBodyStyle
    } = originalBodyStyle;

    const defaultPadding = typeof token.paddingLG === 'number' ? token.paddingLG : 24;
    const resolvedPadding = padding !== undefined ? padding : defaultPadding;

    const collapsibleWrapperStyle: CSSProperties = {
      overflow: 'hidden',
      width: '100%',
      boxSizing: 'border-box',
      transition: 'max-height 0.3s ease, padding-top 0.3s ease, padding-bottom 0.3s ease, opacity 0.2s ease',
      maxHeight: collapsed ? 0 : 9999,
      opacity: collapsed ? 0 : 1,
      pointerEvents: collapsed ? 'none' : 'auto',
      padding: resolvedPadding,
    };

    if (paddingLeft !== undefined) {
      collapsibleWrapperStyle.paddingLeft = paddingLeft;
    }
    if (paddingRight !== undefined) {
      collapsibleWrapperStyle.paddingRight = paddingRight;
    }
    if (collapsed) {
      collapsibleWrapperStyle.paddingTop = 0;
      collapsibleWrapperStyle.paddingBottom = 0;
    } else {
      if (paddingTop !== undefined) {
        collapsibleWrapperStyle.paddingTop = paddingTop;
      }
      if (paddingBottom !== undefined) {
        collapsibleWrapperStyle.paddingBottom = paddingBottom;
      }
    }

    return {
      contentBodyStyle: restBodyStyle,
      wrapperStyle: collapsibleWrapperStyle,
      cardBodyStyle: { padding: 0 },
    };
  }, [bodyStyle, collapseMode, collapsed, token.paddingLG]);

  const contentStyle = contentBodyStyle ? { ...contentBodyStyle } : {};

  return (
    <Card
      {...cardProps}
      title={header}
      extra={undefined}
      headStyle={headStyle}
      bodyStyle={cardBodyStyle}
    >
      {collapseMode === 'compact' ? (
        <div style={wrapperStyle} aria-hidden={collapsed}>
          <div style={{ width: '100%', ...contentStyle }}>{children}</div>
        </div>
      ) : collapsed ? null : (
        children
      )}
    </Card>
  );
}
