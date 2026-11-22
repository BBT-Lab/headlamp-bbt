// 文件描述：验证Rancher集群选择与请求会话的隔离规则。
// 项目名称：Headlamp BBT
// 文件名称：rancher_test.go
// 作者：Codex
// 日期：2026-11-19

package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/auth"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/headlampconfig"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/rancher"
	"github.com/stretchr/testify/require"
)

// TestRancherClusterAccess验证集群请求必须属于当前身份。
//
// :param t: Go测试上下文。
func TestRancherClusterAccess(t *testing.T) {
	prd := rancher.Cluster{ID: "c-sz99k", Name: "prd"}
	teaching := rancher.Cluster{ID: "c-mdnm4", Name: "teaching"}
	allowed := []rancher.Cluster{prd}
	name := rancherClusterName(prd)
	require.True(t, rancherCanAccess("/clusters/"+name+"/api/v1/namespaces", nil, allowed))
	require.True(t, rancherCanAccess("/encoded-clusters/"+auth.EncodeClusterForURL(name)+"/clear-token", nil, allowed))
	require.True(t, rancherCanAccess("/drain-node", url.Values{"cluster": {name}}, allowed))
	require.False(t, rancherCanAccess("/clusters/"+rancherClusterName(teaching)+"/api", nil, allowed))
	require.False(t, rancherCanAccess("/clusters/"+name+"/api", nil, nil))
	require.False(t, rancherCanAccess("/encoded-clusters/invalid!/clear-token", nil, allowed))
}

// TestRancherVisibleClusterMetadata验证显示设置只附加到授权集群的列表。
//
// :param t: Go测试上下文。
func TestRancherVisibleClusterMetadata(t *testing.T) {
	client, err := rancher.NewClient("https://rancher.bbt.sspu.edu.cn", "")
	require.NoError(t, err)
	c := &HeadlampConfig{rancher: &rancherIntegration{client: client}}
	r := httptest.NewRequest(http.MethodGet, "/config", nil)
	identity := &rancher.Identity{Clusters: []rancher.Cluster{
		{ID: "c-sz99k", Name: "prd"},
		{ID: "c-vfttv", Name: "harbor"},
		{ID: "local", Name: "local"},
	}}
	rows := c.rancherClusters(r.WithContext(context.WithValue(r.Context(), rancherIdentityKey{}, identity)))
	require.Len(t, rows, 3)
	require.Equal(t, "prd--c-sz99k", rows[0].Name)
	require.Equal(t, "prd", rows[0].Metadata["rancherDisplayName"])
	require.Equal(t, false, rows[0].Metadata["hideByDefault"])
	require.Equal(t, true, rows[1].Metadata["hideByDefault"])
	require.Equal(t, true, rows[2].Metadata["hideByDefault"])
	require.False(t, rancherCanAccess("/clusters/teaching--c-mdnm4/version", nil, identity.Clusters))
}

// TestRancherRequestContextKey验证客户端标识不能改变服务端选择的会话。
//
// :param t: Go测试上下文。
func TestRancherRequestContextKey(t *testing.T) {
	c := &HeadlampConfig{rancher: &rancherIntegration{}}
	r, err := http.NewRequest(http.MethodGet, "https://headlamp.bbt.sspu.edu.cn/clusters/prd--c-sz99k/api", nil)
	require.NoError(t, err)
	r = mux.SetURLVars(r, map[string]string{"clusterName": "prd--c-sz99k"})
	r.Header.Set("X-HEADLAMP-USER-ID", "client-supplied")
	_, err = c.getContextKeyForRequest(r)
	require.ErrorIs(t, err, rancher.ErrUnauthorized)
	r = r.WithContext(context.WithValue(r.Context(), rancherIdentityKey{}, &rancher.Identity{SessionKey: "session-a"}))
	first, err := c.getContextKeyForRequest(r)
	require.NoError(t, err)
	r = r.WithContext(context.WithValue(r.Context(), rancherIdentityKey{}, &rancher.Identity{SessionKey: "session-b"}))
	second, err := c.getContextKeyForRequest(r)
	require.NoError(t, err)
	require.NotEqual(t, first, second)
	require.Equal(t, statelessContextKey("prd--c-sz99k", "session-a"), first)
}

// TestRancherProxyContextIsolation验证同一集群的连接按会话分别保存。
//
// :param t: Go测试上下文。
func TestRancherProxyContextIsolation(t *testing.T) {
	client, err := rancher.NewClient("https://rancher.bbt.sspu.edu.cn", "")
	require.NoError(t, err)
	store := kubeconfig.NewContextStore()
	c := &HeadlampConfig{
		HeadlampConfig: &headlampconfig.HeadlampConfig{
			HeadlampCFG: &headlampconfig.HeadlampCFG{KubeConfigStore: store, SessionTTL: 86400},
		},
		rancher: &rancherIntegration{client: client},
	}
	name := "prd--c-sz99k"
	require.NoError(t, c.addRancherContext(name, "c-sz99k", "session-a"))
	require.NoError(t, c.addRancherContext(name, "c-sz99k", "session-b"))
	first, err := store.GetContext(statelessContextKey(name, "session-a"))
	require.NoError(t, err)
	second, err := store.GetContext(statelessContextKey(name, "session-b"))
	require.NoError(t, err)
	require.NotSame(t, first, second)
	require.Empty(t, first.AuthInfo.Token)
	require.Empty(t, first.AuthInfo.TokenFile)
	require.Empty(t, first.AuthInfo.ClientKeyData)
	require.True(t, first.Internal)
	require.Equal(t, "https://rancher.bbt.sspu.edu.cn/k8s/clusters/c-sz99k", first.Cluster.Server)
	_, err = store.GetContext(name)
	require.Error(t, err)
	multiplexer := NewMultiplexer(store, false)
	multiplexer.sessionToken = c.rancherSessionToken
	resolved, err := multiplexer.getClusterContextWithFallback(name, "session-b")
	require.NoError(t, err)
	require.Equal(t, second, resolved)
}
