// 文件描述：用本机真实Rancher身份验证集群发现及匿名访问边界。
// 项目名称：Headlamp BBT
// 文件名称：client_live_test.go
// 作者：Codex
// 日期：2026-11-19

package rancher

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/tools/clientcmd"
)

// TestRancherLiveClusters访问真实API；未配置专用kubeconfig时跳过。
//
// :param t: Go测试上下文。
func TestRancherLiveClusters(t *testing.T) {
	path := os.Getenv("HEADLAMP_RANCHER_TEST_KUBECONFIG")
	if path == "" {
		t.Skip("设置HEADLAMP_RANCHER_TEST_KUBECONFIG与HEADLAMP_RANCHER_TEST_CONTEXT后运行真实Rancher只读验证")
	}
	contextName := os.Getenv("HEADLAMP_RANCHER_TEST_CONTEXT")
	require.NotEmpty(t, contextName)
	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: path},
		&clientcmd.ConfigOverrides{CurrentContext: contextName},
	).ClientConfig()
	require.NoError(t, err)
	require.NotEmpty(t, config.BearerToken, "真实验证需要所选kubeconfig中的已有个人令牌")
	server, err := url.Parse(config.Host)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(server.Path, "/k8s/clusters/"))
	clusterID := strings.TrimPrefix(server.Path, "/k8s/clusters/")
	caPEM := config.CAData
	if config.CAFile != "" {
		caPEM, err = os.ReadFile(config.CAFile)
		require.NoError(t, err)
	}
	client, err := NewClient(server.Scheme+"://"+server.Host, string(caPEM))
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	clusters, err := client.Clusters(ctx, config.BearerToken)
	require.NoError(t, err)
	require.NotEmpty(t, clusters)
	found := false
	for _, cluster := range clusters {
		t.Logf("context=%s 可见集群=%s 名称=%s", contextName, cluster.ID, cluster.Name)
		found = found || cluster.ID == clusterID
	}
	require.True(t, found, "发现结果应包含当前真实kubeconfig对应的集群")
	_, err = client.clusterPage(ctx, "", client.Server()+"/v3/clusters")
	require.True(t, errors.Is(err, ErrUnauthorized), "Rancher应拒绝匿名访问集群列表")
}
