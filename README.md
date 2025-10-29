# Unity Runtime Art Resource Analysis

Unity Runtime Art Resource Analysis（又名 UnityProfileV2）是一套用于采集、存储和可视化 Unity 运行时美术资源占用情况的端到端方案。项目将 Unity 客户端、Node.js 遥测服务器以及基于 React 的 Web 仪表盘组合在一起，为美术、程序和性能分析团队提供可追溯的素材使用数据。

## 核心能力
- **统一遥测管线**：Unity 客户端自动采集纹理、网格、渲染纹理、材质、Shader 以及帧时序、内存、线程、IO 等信息，通过 Socket 实时推送到服务器。
- **增量帧合并**：服务器能够将客户端发送的增量帧与历史帧合并，自动补全资源排序与统计，确保时间轴连续性。
- **数据持久化与预览缓存**：所有会话历史存储在 `server/data` 目录的 SQLite 数据库中，同时将贴图和帧截图生成离线预览，方便 Web 端按需读取。
- **远程配置分发**：运维人员可通过 `/config` 接口或仪表盘更新采样频率、最大帧数、采集类别等参数，Unity 客户端会在新会话创建时自动同步配置。
- **局域网即插即用**：服务器自动探测网卡地址并暴露 `/network-info` 接口，便于快速在实验室或会议室网络中部署。

## 目录结构
```
UnityRuntimeArtResourceAnalysis/
├── Client/                # Unity 项目（包含遥测采集脚本与示例场景）
├── server/                # Node.js + Express + Socket.IO 遥测服务器
│   ├── data/              # SQLite 历史库、会话分片库、预览文件
│   └── src/               # 服务入口、配置中心、历史数据管理
├── web/                   # Vite + React 仪表盘（TypeScript + Ant Design + ECharts）
└── start-dev.ps1          # Windows 开发环境一键启动脚本
```

## 组件说明
### Unity 客户端（`Client/`）
- 以 C# 编写的 `AssetTelemetryUtility` 等脚本嵌入到 Unity 项目中。
- 会话启动时向服务器的 `/sessions` 接口注册并获得采集配置。
- 按帧汇报资源列表与指标，可根据配置发送缩略图或跳过预览。
- 断线重连后会继续沿用现有 Session，避免数据碎片化。

### 遥测服务器（`server/`）
- 使用 Express 提供 REST API：`/sessions`（创建/查询）、`/config`（读取/更新配置）、`/network-info` 等。
- 借助 Socket.IO 对 Web 前端广播会话创建、帧更新、配置变更等实时事件。
- `HistoryStore` 负责：
  - 初始化 SQLite 数据库、自动迁移、配置 PRAGMA；
  - 每个会话按需切分子数据库（支持 800MB 限制）并缓存最近帧；
  - 处理贴图/帧截图的 Base64 数据，落盘并返回可缓存的预览 URL；
  - 清理无效预览与历史数据，避免磁盘膨胀。
- `ConfigStore` 管理 `server/data/server-config.json`，对外暴露默认值并提供校验合并逻辑（采样频率、Frame Preview 开关、资源分类等）。

### Web 仪表盘（`web/`）
- 基于 React + TypeScript + Vite，使用 Ant Design 构建界面并通过 ECharts 绘制趋势图。
- `socket.io-client` 保持与服务器的实时连接，自动刷新会话列表与帧详情。
- 支持按资产类型浏览、排序、筛选，展示贴图缩略图与统计指标。
- `npm run build` 可生成静态文件用于部署至任意静态资源服务器。

## 数据流概览
1. Unity 客户端启动会话，通过 `POST /sessions` 注册并获取配置；
2. 客户端按帧发送数据（包含资源列表、性能指标、可选预览图），服务器合并增量并写入 SQLite；
3. 服务器经 Socket.IO 将新帧广播给 Web 前端，前端实时更新仪表盘；
4. Web 端可请求 `GET /sessions/:id` 获取完整历史，也可通过 `/sessions/:id/textures/:textureId` 按需加载贴图详情；
5. 管理员在 Web 端修改采集策略后通过 `PUT /config` 回写，服务器持久化并推送给所有连接的客户端。

## 环境与依赖
- **服务器与前端**：Node.js 18 LTS 及以上版本（已包含 `npx`）。
- **数据库**：内置 `better-sqlite3`，无需单独安装数据库。
- **Unity 客户端**：建议 Unity 2021 LTS 及以上版本，启用 .NET 4.x Runtime。
- **操作系统**：开发与部署默认在 Windows 环境（PowerShell 5.1 或 PowerShell 7）。

## 本地开发（Windows）
1. 克隆仓库后在 PowerShell 中执行依赖安装：
   ```powershell
   cd server
   npm install
   cd ..\web
   npm install
   ```
2. 返回仓库根目录，运行一键启动脚本：
   ```powershell
   .\start-dev.ps1
   ```
   - 默认服务端口：API `48080`，Web `5175`。
   - 可通过参数自定义：`.\start-dev.ps1 -ServerPort 5000 -WebPort 4000`。
   - 脚本会自动使用 `npx kill-port` 释放端口，并在退出时清理子进程。
3. 访问 `http://localhost:5175` 打开仪表盘，Unity 客户端指向 `http://localhost:48080` 即可开始测试。

## Unity 客户端集成步骤
1. 将 `Client/Assets/Telemetry` 下的脚本导入目标项目，确保相关命名空间可用。
2. 在启动场景中挂载遥测管理组件，配置服务器地址（可从 Web 仪表盘的“网络信息”面板复制）。
3. 可选：根据项目需求订阅服务器返回的配置，动态调整采样间隔或禁用贴图预览。
4. 构建或运行 Play 模式后，即可在仪表盘查看实时数据。

## Windows 部署指南（生产环境）
1. **准备环境**：
   - 安装 Node.js 18 LTS（包含 npm）。
   - 在服务器机器上创建目录（例如 `C:\UnityTelemetry`），复制仓库内容或拉取最新代码。
2. **安装依赖**：
   ```powershell
   cd C:\UnityTelemetry\server
   npm install --production
   cd ..\web
   npm install
   npm run build
   ```
   构建后的静态文件位于 `web/dist`。
3. **启动后台服务**：
   - 推荐使用 [PM2](https://pm2.keymetrics.io/) 或 Windows 服务守护：
     ```powershell
     npm install -g pm2
     cd C:\UnityTelemetry\server
     $env:PORT = 48080
     pm2 start npm --name unity-telemetry-server -- run start
     ```
   - 将 `web/dist` 部署到 IIS、Nginx for Windows、或 `npm install -g serve` 后执行 `serve -s dist -l 5175`。
   - 或者在仓库根目录运行 `deploy.ps1`，它会完成依赖安装、Web 构建，并可选择使用 PM2 或前台进程启动 API 与仪表盘服务：
     ```powershell
     # 使用自动模式（有 PM2 则用 PM2，否则使用前台进程）
     .\deploy.ps1

     # 仅准备构建产物，不启动服务
     .\deploy.ps1 -NoStart

     # 强制使用 PM2 并修改端口
     .\deploy.ps1 -Mode Pm2 -ServerPort 5000 -WebPort 6000
     ```
4. **配置反向代理（可选）**：为便于内网访问，可在 IIS/Nginx 中将 `/api` 代理到 `http://localhost:48080`，静态资源指向 `web/dist`。
5. **数据备份**：定期备份 `server/data` 目录（包含历史数据库、预览文件、配置），确保磁盘容量充足并开启增量备份策略。

## 注意事项
- **端口占用**：如与现有服务冲突，请在 PowerShell 脚本或 PM2 启动前设置 `PORT`/`SERVER_PORT`/`WEB_PORT` 环境变量。
- **磁盘空间**：贴图预览与帧截图可能占用大量空间，建议在生产环境调整 `clientDefaults.disableFramePreview` 或降低 `framePreviewScale`。
- **安全性**：默认允许所有来源跨域访问，请在生产环境前通过反向代理、VPN 或防火墙限制访问范围，必要时在 Express 中添加认证。
- **数据库容量**：单个会话数据库文件超过 800MB 时会自动切片；如需长期保留，可将旧会话导出后存档。
- **配置修改**：`/config` 接口会校验输入范围，确保仅提交数字/布尔类型；修改后所有新会话会使用最新配置。
- **Unity 版本兼容**：若使用低版本 Unity，请确认 .NET API 兼容性并适配脚本中的 `System.Text.Json`/`UnityWebRequest` 实现。

## 常见问题排查
| 症状 | 可能原因 | 解决办法 |
| ---- | -------- | -------- |
| Unity 客户端创建 Session 失败 | 无法连接服务器或端口被占用 | 确认 `server` 进程运行并开放 `48080`；检查防火墙规则 |
| Web 仪表盘无实时数据 | Socket 连接失败或浏览器缓存旧版本 | 刷新页面，确保浏览器可以访问 `http://服务器IP:48080/socket.io/` |
| 贴图预览 404 | 预览未生成或已被清理 | 检查服务器日志，确认客户端是否发送 `previewBase64`；必要时增大磁盘配额 |
| 数据库文件不断增大 | 长时间持续采集 | 使用 `/config` 调整 `history.maxSessionFrames` 或定期归档 `server/data/sessions` |
| 修改配置未生效 | Unity 客户端仍使用旧 Session | 结束当前会话（或重启客户端）以加载最新配置 |

## 贡献
欢迎提交 Issue 或 Pull Request，协助完善采集指标、可视化能力以及部署脚本。
