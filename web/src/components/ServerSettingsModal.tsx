import { CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Form,
  FormInstance,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  Flex,
} from 'antd';
import type { ServerConfig, TelemetrySession } from '../types';

interface ServerSettingsModalProps {
  open: boolean;
  config: ServerConfig | null;
  loading: boolean;
  saving: boolean;
  clearing: boolean;
  sessions: TelemetrySession[];
  deletingSessionId: string | null;
  onCancel: () => void;
  onSubmit: (config: Partial<ServerConfig>) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

interface ServerSettingsFormValues {
  sampleIntervalSeconds: number;
  framePreviewScale: number;
  disableFramePreview: boolean;
  maxAssetsPerCategory: number;
  autoManageSession: boolean;
  collectFps: boolean;
  includeTextures: boolean;
  includeMeshes: boolean;
  includeRenderTextures: boolean;
  includeMaterials: boolean;
  includeShaders: boolean;
  maxSessionFrames: number;
}

const DEFAULT_FORM_VALUES: ServerSettingsFormValues = {
  sampleIntervalSeconds: 0.01,
  framePreviewScale: 0.2,
  disableFramePreview: false,
  maxAssetsPerCategory: 200,
  autoManageSession: true,
  collectFps: true,
  includeTextures: true,
  includeMeshes: true,
  includeRenderTextures: true,
  includeMaterials: true,
  includeShaders: true,
  maxSessionFrames: 10000,
};

function buildInitialValues(config: ServerConfig | null): ServerSettingsFormValues {
  if (!config) {
    return { ...DEFAULT_FORM_VALUES };
  }
  const categories = config.clientDefaults?.assetCategories;
  return {
    sampleIntervalSeconds: config.clientDefaults?.sampleIntervalSeconds ?? DEFAULT_FORM_VALUES.sampleIntervalSeconds,
    framePreviewScale: config.clientDefaults?.framePreviewScale ?? DEFAULT_FORM_VALUES.framePreviewScale,
    disableFramePreview: config.clientDefaults?.disableFramePreview ?? DEFAULT_FORM_VALUES.disableFramePreview,
    maxAssetsPerCategory:
      config.clientDefaults?.maxAssetsPerCategory ?? DEFAULT_FORM_VALUES.maxAssetsPerCategory,
    autoManageSession: config.clientDefaults?.autoManageSession ?? DEFAULT_FORM_VALUES.autoManageSession,
    collectFps: config.clientDefaults?.collectFps ?? DEFAULT_FORM_VALUES.collectFps,
    includeTextures: categories?.includeTextures ?? DEFAULT_FORM_VALUES.includeTextures,
    includeMeshes: categories?.includeMeshes ?? DEFAULT_FORM_VALUES.includeMeshes,
    includeRenderTextures: categories?.includeRenderTextures ?? DEFAULT_FORM_VALUES.includeRenderTextures,
    includeMaterials: categories?.includeMaterials ?? DEFAULT_FORM_VALUES.includeMaterials,
    includeShaders: categories?.includeShaders ?? DEFAULT_FORM_VALUES.includeShaders,
    maxSessionFrames: config.history?.maxSessionFrames ?? DEFAULT_FORM_VALUES.maxSessionFrames,
  };
}

const sectionGridStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
};

const toggleGridStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
};

const modalBodyStyle: CSSProperties = {
  maxHeight: '70vh',
  overflowY: 'auto',
  paddingRight: 8,
};

async function submitForm(
  form: FormInstance<ServerSettingsFormValues>,
  onSubmit: (config: Partial<ServerConfig>) => Promise<void>,
  currentConfig: ServerConfig | null
) {
  const values = await form.validateFields();
  const payload: Partial<ServerConfig> = {
    clientDefaults: {
      sampleIntervalSeconds: values.sampleIntervalSeconds,
      framePreviewScale: values.framePreviewScale,
      disableFramePreview: values.disableFramePreview,
      maxAssetsPerCategory: values.maxAssetsPerCategory,
      autoManageSession: values.autoManageSession,
      collectFps: values.collectFps,
      assetCategoryVersion: currentConfig?.clientDefaults?.assetCategoryVersion ?? 1,
      assetCategories: {
        includeTextures: values.includeTextures,
        includeMeshes: values.includeMeshes,
        includeRenderTextures: values.includeRenderTextures,
        includeMaterials: values.includeMaterials,
        includeShaders: values.includeShaders,
      },
    },
    history: {
      maxSessionFrames: values.maxSessionFrames,
    },
  };
  await onSubmit(payload);
}

export default function ServerSettingsModal({
  open,
  config,
  loading,
  saving,
  clearing,
  sessions,
  deletingSessionId,
  onCancel,
  onSubmit,
  onClearHistory,
  onDeleteSession,
}: ServerSettingsModalProps) {
  const [form] = Form.useForm<ServerSettingsFormValues>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const initialValues = useMemo(() => buildInitialValues(config), [config]);

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initialValues);
    }
  }, [open, initialValues, form]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedSessionId((current) => {
      if (current && sessions.some((session) => session.id === current)) {
        return current;
      }
      return sessions.length > 0 ? sessions[0].id : null;
    });
  }, [sessions, open]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => {
        let createdAtLabel = '未知时间';
        if (session.createdAt) {
          const createdAtDate = new Date(session.createdAt);
          if (!Number.isNaN(createdAtDate.getTime())) {
            createdAtLabel = createdAtDate.toLocaleString();
          }
        }
        const ipLabel = session.clientIp ? ` · ${session.clientIp}` : '';
        return {
          value: session.id,
          label: `${createdAtLabel}${ipLabel} · ${session.id}`,
        };
      }),
    [sessions]
  );

  const handleOk = async () => {
    try {
      await submitForm(form, onSubmit, config);
    } catch (error) {
      // Validation errors are handled by antd Form; other errors bubble to the caller.
    }
  };

  const handleClearHistory = async () => {
    await onClearHistory();
  };

  const handleDeleteSelectedSession = async () => {
    if (!selectedSessionId) {
      return;
    }
    try {
      await onDeleteSession(selectedSessionId);
    } catch (error) {
      // 父级组件负责错误提示
    }
  };

  const isDeletingSession = Boolean(deletingSessionId);
  const isDeletingSelectedSession = deletingSessionId === selectedSessionId;

  return (
    <Modal
      title="服务器设置"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="关闭"
      confirmLoading={saving}
      destroyOnClose={false}
      width={720}
      styles={{ body: modalBodyStyle }}
    >
      {loading && !config ? (
        <Space align="center" style={{ width: '100%', justifyContent: 'center', padding: '24px 0' }}>
          <Spin tip="正在加载服务器配置…" />
        </Space>
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          disabled={saving}
          preserve={false}
        >
          <Typography.Title level={5}>客户端采集默认值</Typography.Title>
          <div style={sectionGridStyle}>
            <Form.Item
              label="采样间隔 (秒)"
              name="sampleIntervalSeconds"
              tooltip="每次采集之间的最小间隔，0 表示每帧采集"
              rules={[{ required: true, type: 'number', min: 0 }]}
            >
              <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="帧预览缩放比例"
              name="framePreviewScale"
              tooltip="发送帧截图时的缩放比例，0 表示不发送截图"
              rules={[{ required: true, type: 'number', min: 0, max: 1 }]}
            >
              <InputNumber min={0} max={1} step={0.05} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="每类资源最大数量"
              name="maxAssetsPerCategory"
              tooltip="每次快照中每类资源发送的最大数量"
              rules={[{ required: true, type: 'number', min: 1 }]}
            >
              <InputNumber min={1} step={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="每个会话保留最大帧数"
              name="maxSessionFrames"
              tooltip="超出此数量时会优先丢弃最旧的帧数据"
              rules={[{ required: true, type: 'number', min: 100 }]}
            >
              <InputNumber min={100} step={100} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={toggleGridStyle}>
            <Form.Item
              label="禁用帧截图"
              name="disableFramePreview"
              tooltip="启用后客户端将跳过帧截图采集流程"
              valuePropName="checked"
            >
              <Switch checkedChildren="禁用" unCheckedChildren="开启" />
            </Form.Item>
            <Form.Item
              label="自动管理会话"
              name="autoManageSession"
              tooltip="根据 Unity 播放状态自动开启和结束会话"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item
              label="采集帧率信息"
              name="collectFps"
              tooltip="关闭后客户端不会上报帧率与帧间隔数据"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </div>
          <Typography.Title level={5}>采集资源类别</Typography.Title>
          <div style={toggleGridStyle}>
            <Form.Item
              label="采集纹理数据"
              name="includeTextures"
              tooltip="关闭后客户端将跳过纹理资源的采集"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item
              label="采集网格数据"
              name="includeMeshes"
              tooltip="关闭后客户端将跳过网格资源的采集"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item
              label="采集渲染纹理数据"
              name="includeRenderTextures"
              tooltip="关闭后客户端将跳过渲染纹理资源的采集"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item
              label="采集材质数据"
              name="includeMaterials"
              tooltip="关闭后客户端将跳过材质资源的采集"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item
              label="采集着色器数据"
              name="includeShaders"
              tooltip="关闭后客户端将跳过着色器资源的采集"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <Typography.Title level={5}>历史记录</Typography.Title>

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">删除单个会话记录</Typography.Text>
            {sessions.length > 0 ? (
              <Flex wrap gap={12} align="center">
                <Select<string>
                  style={{ minWidth: 260, flex: '1 1 240px' }}
                  value={selectedSessionId ?? undefined}
                  onChange={(value) => setSelectedSessionId(value)}
                  options={sessionOptions}
                  placeholder="选择一个会话"
                  disabled={isDeletingSession}
                />
                <Popconfirm
                  title="确定要删除该会话及其数据吗？"
                  onConfirm={handleDeleteSelectedSession}
                  okButtonProps={{ danger: true, loading: isDeletingSelectedSession }}
                  disabled={!selectedSessionId || isDeletingSession}
                >
                  <Button
                    danger
                    loading={isDeletingSelectedSession}
                    disabled={!selectedSessionId || isDeletingSession}
                  >
                    删除选中会话
                  </Button>
                </Popconfirm>
              </Flex>
            ) : (
              <Typography.Text type="secondary">暂无会话记录可删除</Typography.Text>
            )}
          </Space>

          <Alert
            type="warning"
            showIcon
            message="清空历史记录将删除所有会话及其帧数据，且不可恢复。"
            style={{ marginBottom: 12 }}
          />

          <Popconfirm
            title="确定要清空所有历史记录吗？"
            onConfirm={handleClearHistory}
            okButtonProps={{ danger: true, loading: clearing }}
            disabled={clearing}
          >
            <Button danger loading={clearing} disabled={clearing}>
              清空所有历史记录
            </Button>
          </Popconfirm>
        </Form>
      )}
    </Modal>
  );
}
