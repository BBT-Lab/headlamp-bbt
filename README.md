# Headlamp BBT

Headlamp BBT基于[Headlamp](https://github.com/kubernetes-sigs/headlamp)，为BBT集群提供Kubernetes网页管理界面。项目会根据集群使用需求修改网页，并开发或修改Headlamp插件。

Headlamp支持查看和管理Kubernetes资源、查看容器日志、使用终端以及通过插件扩展功能。用户可查看和操作的资源取决于其Kubernetes权限。

## 仓库与协作

- [GitHub主仓库](https://github.com/BBT-Lab/headlamp-bbt)：代码协作、Issue、Pull Request、Actions和Release。
- [GitLab同步仓库](http://git.bbt.sspu.edu.cn/Qintsg/headlamp-bbt)：代码与Release同步，以及GitOps部署。
- [Headlamp上游仓库](https://github.com/kubernetes-sigs/headlamp)。

主分支为`main`。请通过GitHub Pull Request合并改动，并将分支和标签同步到两个仓库。详细约定见[AGENTS.md](./AGENTS.md)。

## 本地开发

开发环境需要Node.js、npm和Go。版本要求分别见[package.json](./package.json)和[backend/go.mod](./backend/go.mod)。在项目根目录执行：

```bash
npm install
npm run frontend:install
npm run bbt:plugins:install
npm run backend:build
npm run bbt:plugins:build
npm start
```

前端开发服务器默认使用`http://localhost:3000`。构建和测试命令：

```bash
npm run build
npm run frontend:test
npm run backend:test
```

更多说明见[开发指南](./docs/development/index.md)、[前端开发](./docs/development/frontend.md)、[后端开发](./docs/development/backend.md)和[插件开发](./docs/development/plugins/index.md)。

新浏览器默认使用简体中文（中英双语），资源术语保留英文，例如「命名空间 (Namespace)」。可在设置中切换到简体中文或英语。BBT镜像包含适配后的Headlamp Plus，提供集群、工作负载和命名空间概览。

## BBT单点登录

BBT单点登录通过Rancher OIDC沿用现有账号，自动发现当前用户可访问的全部集群。集群请求使用当前用户的身份，由Rancher校验原有权限。

本机使用`npm run start:bbt-sso`启动网页，访问`http://localhost:4466/`。Client ID和Client Secret通过环境变量提供，本机配置文件`.env.bbt-sso.local`已加入Git与构建忽略规则。应用注册、环境变量和验证步骤见[SSO配置说明](./deploy/web/SSO.md)。

## 发布与部署

每次发布新版本时，在GitHub和GitLab发布相同版本，通过GitLab的GitOps配置和Argo CD将网页部署到[headlamp.bbt.sspu.edu.cn](https://headlamp.bbt.sspu.edu.cn)。

版本标签格式为`v{上游版本号}.bbt.{序号}-YYMMDDHHmm`。同一上游版本的序号从1开始递增，时间使用香港时区。GitHub发布工作流自动生成标签。

## 许可证

本项目采用[Apache License 2.0](./LICENSE)。
