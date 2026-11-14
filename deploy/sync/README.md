# GitHub与GitLab同步

`headlamp-repository-sync`运行在`prd`集群的`headlamp`命名空间，每15分钟从GitHub拉取分支、标签和已发布的Release，并同步至GitLab项目`Qintsg/headlamp-bbt`。

同步任务保留GitLab中独有的引用。GitLab分支与GitHub发生无法快进的分歧，或同名发布附件内容不一致时，任务报错并保留现有数据。Release附件上传到GitLab通用软件包仓库，Release页面链接到相应文件。

在GitHub Actions运行 **Headlamp BBT Release**，输入版本号，例如`0.0.1`。工作流按香港时间生成`v0.0.1-bbt-YYMMDDHHmm`标签，将OCI镜像归档、镜像摘要和部署清单附到Release。

校内同步任务下载附件并校验SHA-256，将最新正式版的镜像导入`harbor.bbt.sspu.edu.cn/sspu/headlamp-bbt`。确认Harbor能按摘要拉取后，任务更新GitLab的`bbt-production`分支。Argo CD的`headlamp`应用跟踪该分支的`production`目录。应用Pod从Harbor拉取镜像。

`headlamp-sync-data`保存Git缓存和临时附件；CronJob通过`Forbid`限制并发。Secret `headlamp-sync-credentials`包含`github-token`和`gitlab-token`：前者具有GitHub仓库Contents只读权限，后者是具有Maintainer角色及`api`、`write_repository`权限的GitLab项目令牌。令牌通过集群Secret管理，不能写入仓库。

同步任务使用`headlamp-harbor-push`镜像仓库Secret。该Secret包含Harbor Robot Account凭据，权限为`sspu`项目的Pull Repository和Push Repository。生产配置可用`kubectl kustomize deploy/sync`渲染。命名空间、内部根证书ConfigMap和Secret由集群管理员管理。

查看同步状态：

```bash
kubectl --context prd -n headlamp get cronjob,job,pod,pvc
kubectl --context prd -n headlamp logs job/<作业名称> --all-containers
```

如需手动执行一次同步，可从CronJob创建Job，并在验证后清理该临时Job。定时任务与手动任务需要避免同时运行。
