# DeepSeek Desktop

[中文](README.md) | [English](README.en.md)

DeepSeek Desktop 是一个面向 Windows x64 的轻量桌面壳，原样运行官方
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI。

> 本项目是独立的社区项目，并非 DeepSeek 官方产品，也未获得 DeepSeek 官方背书。
> DeepSeek 是 DeepSeek AI 的商标。

## v0.9.0 特性

- 内置官方 `@deepseek-ai/dsh@0.1.0-rc.6` 和 Node.js 24.11.0
- 使用原生 Windows 窗口显示完整 Harness Web UI
- 默认复用 `~/.dsh` 中的模型、会话、工作区和插件配置
- 仅监听 `127.0.0.1`，优先使用 3080，端口占用时自动使用随机端口
- Harness 与宠物 Renderer 均不启用 Node.js，只暴露各自受限的桌面桥接
- 关闭窗口时同时停止本地 Harness
- 安装阶段静默预热官方 Harness 与 Web UI，提前完成首次初始化
- 通过官方 `--patch` 扩展接口加入 Codex 风格账户上拉框，不修改官方源码
- 内置适配自 Anywhere Labs `dsh-community-market` 的社区插件市场，可在设置或账户菜单中打开
- 聚合 DSH 1024 Store 与 DSHFind 插件目录，保留来源、兼容性、版本和风险提示
- 插件安装前核验 npm 元数据、仓库回链、运行时兼容性与生命周期脚本，并只安装精确版本
- 通过官方 Harness `plugin --profile web` 命令安装和卸载插件，不直接改写 Harness Agent 或 Profile 清单
- 保存安装收据并支持卸载、失败回滚、重启验证、异常启动自动恢复及一键打开 DSH 终端
- 在 Harness 主机侧安全读取 DeepSeek API Key，并显示官方账户余额
- 显示当前会话的输入、输出、缓存和推理 Token 统计
- 使用官方 `session.models/selectModel` 接口提供三档思考强度滑块
- 上拉框内可打开 Harness 设置或退出桌面端
- 保持 Harness 原生配色，在宽屏新会话和对话界面持续显示工作款鲸鱼娘立绘
- 内置 DeepSeek 宠物，使用 Codex 九状态图集、官方播放节奏和任务完成/失败/待处理提醒
- 桌宠运行在独立的透明无边框顶层窗口中，可跨出 DeepSeek 主窗口并在多显示器工作区内拖动
- 透明窗口不显示在任务栏，角色命中区之外点击穿透；与 Codex 桌宠使用不同窗口标题、IPC 和数据目录
- 内置宠物采用无道具的安静待机帧；悬停只播放短跳，普通点击不额外触发动作
- 拖动累计超过 4px 才按横向方向播放跑步，窗口按屏幕坐标平滑跟随，松手立即清除跑步状态
- 桌宠位置保存在 `%APPDATA%\DeepSeek Desktop\deepseek-pet-window.json`，不写入 Harness 或 Codex 配置
- 内置宠物不启用全局鼠标追视；导入的 Codex V2 宠物仍支持 16 方向追视
- 使用基于 elapsed time 的 `requestAnimationFrame` 播放器，掉帧后自动追上正确帧
- 拖动事件按显示帧合并并直接更新宠物位置，避免每帧重渲染整个 React 组件
- 清理内置鲸鱼娘图集各行动帧的残余 Alpha 块，并清空未使用单元格，深色背景下不再出现矩形残片
- 动画和窗口位移完全解耦；每个动作行只做一次静态中心对齐，循环末尾不再重置逐帧补偿
- 独立窗口为最大缩放和左右动作保留对称透明安全区，尾巴与裙摆不会被窗口边缘裁切
- 内置鲸鱼娘的活动帧以约 12 FPS 更新；导入的 Codex 宠物继续采用其原始 Codex 节奏
- 已完成的旧会话不会持续占用宠物动作，任务切换会清理失效的交互状态
- DeepSeek 宠物只在自己的 Renderer、Cookie、桥接和 `%APPDATA%\\DeepSeek Desktop\\pets` 中运行，不创建或覆盖 Codex 宠物窗口
- 账户上拉框只显示桌宠摘要，选择、动画、大小、位置和导入操作集中在独立管理窗
- 支持导入 Codex V1 `1536×1872` 与 V2 `1536×2288` 自定义宠物包
- DeepSeek 宠物使用独立命名空间和 `%APPDATA%\DeepSeek Desktop\pets`，不读取或覆盖 Codex 宠物
- 使用鲸鱼娘作为应用、安装包、快捷方式和账户菜单图标

桌面壳不会复制、记录或管理 API Key，也不会修改官方 Harness 的源码、Agent 或 Profile 清单。
余额请求由随应用打包的 Harness Companion 插件在主机侧完成，Renderer 只能获得余额结果，
无法读取原始 Key。桌面端仅向受信任的 Harness 页面暴露 `quit()` 和受限的宠物库桥接，
宠物库只允许读写应用自己的目录。
官方 Harness 在首次启动时会自行初始化缺失的 Web Profile，并维护
`profiles/node_modules` 下的运行时 Junction。桌面端也只在该回退目录中维护自己的
`@deepseek-desktop/companion` 与 `@deepseek-desktop/market` Junction；若同名位置是真实目录则拒绝覆盖并报错。

DeepSeek Desktop 的程序代码采用 MIT License。鲸鱼娘应用图标、账户头像和工作款立绘
不包含在 MIT 授权中，单独按 CC BY-NC-SA 4.0 使用，仅限非商业用途，并要求署名及
相同方式共享。完整许可与创作链见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
和 `licenses/`。本项目仍是非官方社区客户端，不代表相关作者或 DeepSeek 官方背书。

## 开发

要求：Windows 10/11 x64、Node.js 24.11.0、npm。

```powershell
npm install
npm run typecheck
npm test
npm run smoke:harness
npm start
```

## 打包

```powershell
npm run package:dir
npm run dist:win
```

安装包输出到 `dist/DeepSeek-Desktop-Setup-0.9.0-x64.exe`。当前版本未进行代码签名，
Windows SmartScreen 可能显示“未知发布者”。

## 数据目录

应用优先使用环境变量 `DSH_HOME`；未设置时使用 `%USERPROFILE%\.dsh`。
卸载 DeepSeek Desktop 不会删除该目录。

## License

[MIT](LICENSE)
