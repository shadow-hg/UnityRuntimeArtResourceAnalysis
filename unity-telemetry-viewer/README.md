# Unity Telemetry Viewer (frontend)

Minimal React + Vite frontend to visualize telemetry from the local telemetry server.

Run in development:

```bash
cd unity-telemetry-viewer
npm install
npm run dev
```

Build static files:

```bash
npm run build
```

The telemetry server will serve static files if you copy the `dist` output to `telemetry-server` static path or configure accordingly.
# Unity Telemetry Viewer

## 项目简介
Unity Telemetry Viewer 是一个前端应用，旨在通过局域网实时查看手机设备上传入的数据。该应用能够记录每一帧的数据，并显示当前帧对应的游戏画面，帮助开发者进行调试和分析。

## 项目结构
```
unity-telemetry-viewer
├── public
│   └── index.html          # 前端应用的主HTML文件
├── src
│   ├── main.tsx           # 应用的入口文件
│   ├── App.tsx            # 主应用组件
│   ├── styles
│   │   └── app.css        # 应用的样式文件
│   ├── components
│   │   ├── Toolbar.tsx    # 工具栏组件
│   │   ├── ConnectionPanel.tsx # 连接状态和输入界面组件
│   │   ├── Timeline.tsx    # 时间轴组件
│   │   ├── FrameList.tsx   # 帧数据列表组件
│   │   └── FrameViewer.tsx  # 当前帧游戏画面组件
│   ├── services
│   │   └── websocket.ts    # WebSocket服务实现
│   ├── hooks
│   │   └── useTelemetry.ts  # 自定义Hook管理遥测数据
│   ├── types
│   │   └── telemetry.d.ts   # 遥测数据类型定义
│   └── utils
│       └── time.ts         # 时间相关工具函数
├── package.json            # npm配置文件
├── tsconfig.json           # TypeScript配置文件
├── vite.config.ts          # Vite配置文件
└── README.md               # 项目文档和使用说明
```

## 安装与使用
1. 克隆项目到本地：
   ```
   git clone <repository-url>
   cd unity-telemetry-viewer
   ```

2. 安装依赖：
   ```
   npm install
   ```

3. 启动开发服务器：
   ```
   npm run dev
   ```

4. 在浏览器中访问 `http://localhost:3000`（或其他指定端口）以查看应用。

## 功能
- 实时查看手机设备上传入的数据。
- 记录每一帧的数据并以时间轴线性展示。
- 显示当前帧对应的游戏画面。
- 提供连接和断开连接的功能。

## 贡献
欢迎任何形式的贡献！请提交问题或拉取请求以帮助改进项目。

## 许可证
本项目采用 MIT 许可证，详情请参阅 LICENSE 文件。