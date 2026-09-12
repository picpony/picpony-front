## 部署

需要 Bun。网络/几何/回归脚本使用 Node.js 22.18+。

首先，Clone项目后在项目根目录运行:

```bash
bun install
```

稍等片刻，依赖安装完成后运行:

```bash
bun run dev
```

最后访问 [http://localhost:3100](http://localhost:3100) 即可

提交前检查：

```bash
bun run lint
bun run test
bun run colors
bun run build
bun run net:audit
```

`test` 覆盖富文本安全、资源缓存、会话写入及标签翻译。浏览器回归使用本地 fixture，不发送线上业务写入：

```bash
bun run test:security
bun run test:overlays
```

浏览器脚本需要 Python Playwright 和 Microsoft Edge；安装依赖可运行 `python -m pip install playwright`。构建后还可运行 `bun run test:favorites`，检查多页收藏更新、失败重试和特殊标签名。其余网络/动效探针通过 Edge CDP 运行。`bun run icons` 可从已有图标重新生成 PWA 图标。

生产发布先运行 `bun run build`。本项目输出 standalone 包：将 `public` 和 `.next/static` 分别复制到 `.next/standalone/public`、`.next/standalone/.next/static`，再运行 `node .next/standalone/server.js`；端口由 `PORT` 环境变量指定。
