# Headlamp Plus for BBT

此目录基于Headlamp Plus 0.2.0和本机已安装的简体中文适配，保留原作者的许可证和声明。

插件提供浅色及深色主题，以及集群、工作负载和命名空间概览。界面语言跟随Headlamp。简体中文使用中文术语，中英双语保留Kubernetes术语原名，英语沿用插件本身的文案。Rancher登录由Headlamp负责。

在仓库根目录运行：

```powershell
npm run bbt:plugins:install
npm run bbt:plugins:build
npm --prefix plugins/bbt/headlamp-plus run check:locales
```

构建会生成项目的`.plugins/headlamp-plus`目录。BBT镜像会把该目录作为内置插件打包。
