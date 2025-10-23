import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Form,
  FormInstance,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  theme,
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
  includeTextures: boolean;
  includeMeshes: boolean;
  includeRenderTextures: boolean;
  includeMaterials: boolean;
  includeShaders: boolean;
  includeFrameInsights: boolean;
  includeSystemStats: boolean;
  includeAssetIo: boolean;
  includeEnvironment: boolean;
  maxSessionFrames: number;
}

const DEFAULT_FORM_VALUES: ServerSettingsFormValues = {
  sampleIntervalSeconds: 0,
  framePreviewScale: 0.2,
  disableFramePreview: false,
  maxAssetsPerCategory: 200,
  autoManageSession: true,
  includeTextures: true,
  includeMeshes: true,
  includeRenderTextures: true,
  includeMaterials: true,
  includeShaders: true,
  includeFrameInsights: true,
  includeSystemStats: true,
  includeAssetIo: true,
  includeEnvironment: true,
  maxSessionFrames: 10000,
};

function buildInitialValues(config: ServerConfig | null): ServerSettingsFormValues {
  if (!config) {
    return { ...DEFAULT_FORM_VALUES };
  }
  const categories = config.clientDefaults?.assetCategories;
  const telemetrySections = config.clientDefaults?.telemetrySections;
  return {
    sampleIntervalSeconds: config.clientDefaults?.sampleIntervalSeconds ?? DEFAULT_FORM_VALUES.sampleIntervalSeconds,
    framePreviewScale: config.clientDefaults?.framePreviewScale ?? DEFAULT_FORM_VALUES.framePreviewScale,
    disableFramePreview: config.clientDefaults?.disableFramePreview ?? DEFAULT_FORM_VALUES.disableFramePreview,
    maxAssetsPerCategory:
      config.clientDefaults?.maxAssetsPerCategory ?? DEFAULT_FORM_VALUES.maxAssetsPerCategory,
    autoManageSession: config.clientDefaults?.autoManageSession ?? DEFAULT_FORM_VALUES.autoManageSession,
    includeTextures: categories?.includeTextures ?? DEFAULT_FORM_VALUES.includeTextures,
    includeMeshes: categories?.includeMeshes ?? DEFAULT_FORM_VALUES.includeMeshes,
    includeRenderTextures: categories?.includeRenderTextures ?? DEFAULT_FORM_VALUES.includeRenderTextures,
    includeMaterials: categories?.includeMaterials ?? DEFAULT_FORM_VALUES.includeMaterials,
    includeShaders: categories?.includeShaders ?? DEFAULT_FORM_VALUES.includeShaders,
    includeFrameInsights: telemetrySections?.includeFrameInsights ?? DEFAULT_FORM_VALUES.includeFrameInsights,
    includeSystemStats: telemetrySections?.includeSystemStats ?? DEFAULT_FORM_VALUES.includeSystemStats,
    includeAssetIo: telemetrySections?.includeAssetIo ?? DEFAULT_FORM_VALUES.includeAssetIo,
    includeEnvironment: telemetrySections?.includeEnvironment ?? DEFAULT_FORM_VALUES.includeEnvironment,
    maxSessionFrames: config.history?.maxSessionFrames ?? DEFAULT_FORM_VALUES.maxSessionFrames,
  };
}

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
      assetCategoryVersion: currentConfig?.clientDefaults?.assetCategoryVersion ?? 1,
      assetCategories: {
        includeTextures: values.includeTextures,
        includeMeshes: values.includeMeshes,
        includeRenderTextures: values.includeRenderTextures,
        includeMaterials: values.includeMaterials,
        includeShaders: values.includeShaders,
      },
      telemetrySections: {
        includeFrameInsights: values.includeFrameInsights,
        includeSystemStats: values.includeSystemStats,
        includeAssetIo: values.includeAssetIo,
        includeEnvironment: values.includeEnvironment,
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
  const { token } = theme.useToken();

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
      width={960}
      styles={{
        body: {
          maxHeight: '70vh',
          overflowY: 'auto',
        },
      }}
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
          <Flex vertical gap={24}>
            <Flex gap={16} wrap align="stretch">
              <Card
                title="客户端采集默认值"
                style={{
                  flex: '1 1 0',
                  minWidth: 280,
                  background: token.colorBgContainer,
                }}
                styles={{ body: { padding: 0 }, header: { padding: '16px 20px' } }}
                bordered={false}
              >
                <div style={{ padding: '0 20px 20px' }}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
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
                        label="禁用帧截图"
                        name="disableFramePreview"
                        tooltip="启用后客户端将跳过帧截图采集流程"
                        valuePropName="checked"
                      >
                        <Switch checkedChildren="禁用" unCheckedChildren="开启" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        label="每类资源最大数量"
                        name="maxAssetsPerCategory"
                        tooltip="每次快照中每类资源发送的最大数量"
                        rules={[{ required: true, type: 'number', min: 1 }]}
                      >
                        <InputNumber min={1} step={1} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item
                        label="自动管理会话"
                        name="autoManageSession"
                        tooltip="根据 Unity 播放状态自动开启和结束会话"
                        valuePropName="checked"
                      >
                        <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              </Card>
              <Card
                title="历史记录"
                style={{
                  flex: '1 1 320px',
                  minWidth: 300,
                  maxWidth: 400,
                  background: token.colorBgContainer,
                }}
                styles={{ body: { padding: '16px 20px 20px' }, header: { padding: '16px 20px' } }}
                bordered={false}
              >
                <Flex vertical gap={16}>
                  <Form.Item
                    label="每个会话保留最大帧数"
                    name="maxSessionFrames"
                    tooltip="超出此数量时会优先丢弃最旧的帧数据"
                    rules={[{ required: true, type: 'number', min: 100 }]}
                  >
                    <InputNumber min={100} step={100} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Typography.Text type="secondary">删除单个会话记录</Typography.Text>
                    {sessions.length > 0 ? (
                      <Space wrap size={[8, 8]} style={{ width: '100%', display: 'flex' }}>
                        <Select<string>
                          style={{ minWidth: 220, flex: '1 1 220px' }}
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
                            style={{ flex: '0 0 auto' }}
                          >
                            删除选中会话
                          </Button>
                        </Popconfirm>
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">暂无会话记录可删除</Typography.Text>
                    )}
                  </Space>
                  <Alert
                    type="warning"
                    showIcon
                    message="清空历史记录将删除所有会话及其帧数据，且不可恢复。"
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
                </Flex>
              </Card>
            </Flex>

            <Flex gap={16} wrap align="stretch">
              <Card
                title="采集资源类别"
                style={{
                  flex: '1 1 360px',
                  minWidth: 300,
                  background: token.colorBgContainer,
                }}
                styles={{ body: { padding: '16px 20px 4px' }, header: { padding: '16px 20px' } }}
                bordered={false}
              >
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item
                      label="采集纹理数据"
                      name="includeTextures"
                      tooltip="关闭后客户端将跳过纹理资源的采集"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item
                      label="采集网格数据"
                      name="includeMeshes"
                      tooltip="关闭后客户端将跳过网格资源的采集"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item
                      label="采集渲染纹理数据"
                      name="includeRenderTextures"
                      tooltip="关闭后客户端将跳过渲染纹理资源的采集"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item
                      label="采集材质数据"
                      name="includeMaterials"
                      tooltip="关闭后客户端将跳过材质资源的采集"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item
                      label="采集着色器数据"
                      name="includeShaders"
                      tooltip="关闭后客户端将跳过着色器资源的采集"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
              <Card
                title="性能数据采集"
                style={{
                  flex: '1 1 320px',
                  minWidth: 300,
                  background: token.colorBgContainer,
                }}
                styles={{ body: { padding: '16px 20px 4px' }, header: { padding: '16px 20px' } }}
                bordered={false}
              >
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12} md={12}>
                    <Form.Item
                      label="帧执行明细"
                      name="includeFrameInsights"
                      tooltip="关闭后将不会采集 CPU/GPU 耗时与渲染阶段细节"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={12}>
                    <Form.Item
                      label="系统占用"
                      name="includeSystemStats"
                      tooltip="关闭后将不会采集内存、GC 与线程利用率数据"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={12}>
                    <Form.Item
                      label="资产 IO"
                      name="includeAssetIo"
                      tooltip="关闭后将不会采集资源加载与卸载的统计信息"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={12}>
                    <Form.Item
                      label="运行环境"
                      name="includeEnvironment"
                      tooltip="关闭后将不会采集设备、场景及玩家位置信息"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            </Flex>
          </Flex>
        </Form>
      )}
    </Modal>
  );
}
