# 项目协作规范

## 项目与仓库

Headlamp BBT基于[kubernetes-sigs/headlamp](https://github.com/kubernetes-sigs/headlamp)，用于适配BBT集群。项目会修改Headlamp网页，并开发或修改插件。

- 主仓库：GitHub `https://github.com/BBT-Lab/headlamp-bbt.git`。
- 同步仓库：GitLab `http://git.bbt.sspu.edu.cn/Qintsg/headlamp-bbt.git`。
- 上游仓库：`https://github.com/kubernetes-sigs/headlamp.git`。
- 主分支：`main`。

## 开发与发布

- 所有改动通过GitHub Pull Request合并到`main`。日常开发使用独立分支，Issue和Pull Request均在GitHub处理。
- 所有推送都要同步到GitHub和GitLab，包括开发分支、`main`和发布标签。推送后分别核对两个仓库的对应引用；单个远端失败时，修复并补推，直至两边一致。
- 每次发布相同版本时，在GitHub和GitLab分别创建Release，并确保版本标签和发布内容一致。
- 发布标签格式为`v{上游版本号}.bbt.{序号}-YYMMDDHHmm`。同一上游版本的序号从1开始递增，时间使用香港时区，由GitHub发布工作流生成。
- 每次发布新版本，通过GitLab中的GitOps配置和Argo CD将网页部署到`headlamp.bbt.sspu.edu.cn`。
- 除GitOps外，自动化操作和Actions均在GitHub执行。GitLab用于仓库同步、Release和GitOps。
- 保留上游项目的许可证和版权声明；修改上游代码时遵循现有目录中的实现习惯。

## 本地Git配置

`origin`从GitHub拉取，并同时推送到GitHub和GitLab；`upstream`用于获取Headlamp上游更新。克隆后可以用以下命令配置：

```bash
git remote set-url --add --push origin https://github.com/BBT-Lab/headlamp-bbt.git
git remote set-url --add --push origin http://git.bbt.sspu.edu.cn/Qintsg/headlamp-bbt.git
git remote add upstream https://github.com/kubernetes-sigs/headlamp.git
git remote -v
```

使用`git push origin <分支>`或`git push origin <标签>`推送，再分别检查两个远端。两个远端分别接收推送，需要确认各自的结果。

## 代码与验证

- `frontend/`：React和TypeScript网页；`backend/`：Go服务端；`plugins/`：插件工具与示例；`app/`：桌面应用；`charts/headlamp/`：Helm chart。
- Node.js和npm版本要求见根目录`package.json`，Go版本和工具链见`backend/go.mod`。
- 开发与构建命令见`package.json`和`docs/development/`。常用命令包括`npm start`、`npm run build`、`npm run frontend:test`和`npm run backend:test`。
- 根据改动范围执行相应测试和检查；网页改动应验证实际界面，插件改动应验证加载与相关功能。文档中的命令和链接应与仓库内容一致。
- GitHub Pull Request说明改动、验证方式和结果；界面改动附截图。
