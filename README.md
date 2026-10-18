## 部署

!!需要安装bun

首先，Clone项目后在项目根目录运行:

```bash
bun install
```

稍等片刻，依赖安装完成后运行:

```bash
bun run dev
```

最后访问 [http://localhost:3100](http://localhost:3100) 即可

## 生产构建产物

推 `v*` 标签，或在 Actions 里手动运行 CI（Run workflow）时，构建通过后会额外上传一份可直接运行的产物：`picpony-front-linux-x64-<ref>`（运行页底部的 Artifacts）。

下载解压后（需要 Node.js 22.18 或更新，无需再装依赖）：

```bash
sh run.sh   # 默认监听 http://localhost:3100
```

它是 `next build` 的 standalone 输出，已补齐 `.next/static` 与 `public/`，并带有 `README.txt`。
`sharp` 的 libvips 原生库跟随构建平台，所以只提供 Linux x64 包；本机想生成同样的一份：

```bash
npm run build
npm run package:standalone
```
