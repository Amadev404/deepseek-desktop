# DeepSeek Desktop

DeepSeek Desktop 是一个面向 Windows x64 的轻量桌面壳，原样运行官方
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI。

> 本项目是独立的社区项目，并非 DeepSeek 官方产品，也未获得 DeepSeek 官方背书。
> DeepSeek 是 DeepSeek AI 的商标。

## v0.2.0 特性

- 内置官方 `@deepseek-ai/dsh@0.1.0-rc.6` 和 Node.js 24.11.0
- 使用原生 Windows 窗口显示完整 Harness Web UI
- 默认复用 `~/.dsh` 中的模型、会话、工作区和插件配置
- 仅监听 `127.0.0.1`，优先使用 3080，端口占用时自动使用随机端口
- Renderer 不启用 Node.js，只暴露一个不可传参的 `quit()` 最小桥接
- 关闭窗口时同时停止本地 Harness
- 安装阶段静默预热官方 Harness 与 Web UI，提前完成首次初始化
- 通过官方 `--patch` 扩展接口加入 Codex 风格账户上拉框，不修改官方源码
- 在 Harness 主机侧安全读取 DeepSeek API Key，并显示官方账户余额
- 显示当前会话的输入、输出、缓存和推理 Token 统计
- 使用官方 `session.models/selectModel` 接口提供三档思考强度滑块
- 上拉框内可打开 Harness 设置或退出桌面端

桌面壳不会复制、记录或管理 API Key，也不会修改官方 Harness 的 Agent 或 Profile 清单。
余额请求由随应用打包的 Harness Companion 插件在主机侧完成，Renderer 只能获得余额结果，
无法读取原始 Key。桌面端仅向受信任的 Harness 页面暴露一个只含 `quit()` 的最小桥接。
官方 Harness 在首次启动时会自行初始化缺失的 Web Profile，并维护
`profiles/node_modules` 下的运行时 Junction。桌面端也只在该回退目录中维护自己的
`@deepseek-desktop/companion` Junction；若同名位置是真实目录则拒绝覆盖并报错。

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

安装包输出到 `dist/DeepSeek-Desktop-Setup-0.2.0-x64.exe`。当前版本未进行代码签名，
Windows SmartScreen 可能显示“未知发布者”。

## 数据目录

应用优先使用环境变量 `DSH_HOME`；未设置时使用 `%USERPROFILE%\.dsh`。
卸载 DeepSeek Desktop 不会删除该目录。

## License

[MIT](LICENSE)
