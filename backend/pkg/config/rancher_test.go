// 文件描述：验证Rancher配置与本机个人kubeconfig的使用边界。
// 项目名称：Headlamp BBT
// 文件名称：rancher_test.go
// 作者：Codex
// 日期：2026-11-19

package config //nolint:testpackage // 验证内部解析流程在Rancher模式下跳过个人kubeconfig。

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestRancherRejectsInvalidEndpoint拒绝带凭证、路径或非TLS的服务地址。
//
// :param t: Go测试上下文。
func TestRancherRejectsInvalidEndpoint(t *testing.T) {
	for _, endpoint := range []string{
		"http://rancher.bbt.sspu.edu.cn",
		"https://rancher.bbt.sspu.edu.cn/v3",
		"https://rancher.bbt.sspu.edu.cn?cluster=prd",
		"https://rancher.bbt.sspu.edu.cn#prd",
	} {
		t.Run(endpoint, func(t *testing.T) {
			c := Config{RancherURL: endpoint}
			require.ErrorContains(t, c.validateRancher(), "HTTPS origin")
		})
	}
}

// TestRancherDoesNotLoadPersonalKubeconfig验证SSO模式不会读取个人凭证。
//
// :param t: Go测试上下文。
func TestRancherDoesNotLoadPersonalKubeconfig(t *testing.T) {
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "personal-kubeconfig"))

	c := Config{RancherURL: "https://rancher.bbt.sspu.edu.cn"}
	require.NoError(t, setKubeConfigPath(&c))
	require.Empty(t, c.KubeConfigPath)
	c.OidcIdpIssuerURL = c.RancherURL + "/oidc"
	require.ErrorContains(t, c.validateRancher(), "client secret")
}
