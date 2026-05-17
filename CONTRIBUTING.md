# 贡献指南

感谢你对 GateAPI 的关注！欢迎提交 Issue 和 Pull Request。

## 提交 Issue

- **Bug 报告**：请描述复现步骤、期望行为、实际行为，并附上日志截图
- **功能建议**：请说明使用场景和预期效果
- 提交前请先搜索是否已有相同 Issue

## 提交 Pull Request

### 环境准备

```bash
# 依赖
# - Node.js 18+
# - npm

git clone https://github.com/Nasan-Duodushu/GateAPI.git
cd gateapi
npm install
```

### 开发运行

```bash
# 开发模式（文件变更自动重启）
npm run dev

# 生产模式
npm start
```

### 项目结构

```
src/
├── index.js            # Express 入口
├── config.js           # 配置加载
├── store.js            # SQLite 存储
├── router.js           # API 路由 + 重试
├── scheduler.js        # 定时检测 + 被动采样
├── relay/
│   ├── distributor.js  # 智能路由引擎
│   └── forwarder.js    # 请求转发 + 协议转换
├── admin/
│   └── api.js          # 管理 API
└── detective/
    ├── engine.js       # 检测引擎（探针 + 评分）
    ├── fingerprints.js # 模型指纹库
    └── modeldb.js      # 模型数据库
web/
└── index.html          # 管理面板（单文件 SPA）
```

### 代码规范

- 使用 2 空格缩进
- 字符串使用单引号
- 不添加不必要的分号
- 变量命名使用 camelCase
- 文件命名使用 kebab-case
- 保持现有代码风格一致

### PR 流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: 简要描述"`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request，描述你的更改内容

### Commit 规范

```
feat: 新功能
fix: 修复 Bug
docs: 文档更新
refactor: 代码重构（不影响功能）
perf: 性能优化
test: 测试相关
chore: 构建/工具链变更
```

### 开发注意事项

- `data/` 目录存放运行时数据，不要提交到 Git
- `config.example.json` 是配置模板，修改后需同步更新
- 管理面板是单文件 `web/index.html`，修改后刷新浏览器即可预览
- 检测引擎探针新增后需在 `PROBE_I18N`（index.html）中添加中英文翻译
- 模型指纹新增后需在 `fingerprints.js` 中补充实测数据

## License

本项目使用 Apache License 2.0 协议，提交 PR 即表示你同意将代码以相同协议开源。
