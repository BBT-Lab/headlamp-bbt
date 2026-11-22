// 文件描述：接入Rancher登录会话、集群自动发现及用户请求代理。
// 项目名称：Headlamp BBT
// 文件名称：rancher.go
// 作者：Codex
// 日期：2026-11-19

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/kubernetes-sigs/headlamp/backend/pkg/auth"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/cache"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/logger"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/rancher"
	"golang.org/x/oauth2"
	"k8s.io/client-go/tools/clientcmd/api"
)

const rancherSessionCookie = "headlamp-rancher-session"

type rancherIdentityKey struct{}

type rancherIntegration struct {
	client   *rancher.Client
	sessions *rancher.Sessions
	login    string
	mu       sync.Mutex
}

// requestRancherIdentity读取中间件验证过的请求身份。
//
// :param r: 当前HTTP请求。
// :returns: 用户身份或未登录错误。
func requestRancherIdentity(r *http.Request) (*rancher.Identity, error) {
	identity, ok := r.Context().Value(rancherIdentityKey{}).(*rancher.Identity)
	if !ok {
		return nil, rancher.ErrUnauthorized
	}

	return identity, nil
}

// setupRancher配置独立登录入口，全程使用当前用户会话。
//
// :param ctx: 服务生命周期上下文。
// :param c: Headlamp配置。
// :returns: 初始化错误。
func setupRancher(ctx context.Context, c *HeadlampConfig) error {
	if c.RancherURL == "" {
		return nil
	}

	client, err := rancher.NewClient(c.RancherURL, c.OidcCACert)
	if err != nil {
		return err
	}

	c.rancher = &rancherIntegration{
		client:   client,
		sessions: rancher.NewSessions(client, c.OidcClientID, c.OidcClientSecret, time.Duration(c.SessionTTL)*time.Second),
		login:    kubeconfig.MakeDNSFriendly(c.InClusterContextName),
	}

	go func() {
		<-ctx.Done()

		if err := c.rancher.sessions.Close(); err != nil {
			logger.Log(logger.LevelError, nil, err, "关闭Rancher会话存储")
		}
	}()

	if multiplexer, ok := c.Multiplexer.(*Multiplexer); ok {
		multiplexer.sessionToken = c.rancherSessionToken
	}

	return c.addRancherContext(c.rancher.login, "local", "")
}

// rancherSessionToken为长连接验证会话、集群成员关系并取得当前令牌。
//
// :param cluster: Headlamp集群名称。
// :param key: 服务端会话摘要。
// :returns: 当前用户访问令牌或会话错误。
func (c *HeadlampConfig) rancherSessionToken(cluster, key string) (string, error) {
	identity, err := c.rancher.sessions.IdentityByKey(c.ServerCtx, key, false)
	if err != nil {
		return "", err
	}

	if !rancherCanAccess("/clusters/"+cluster+"/", nil, identity.Clusters) {
		return "", rancher.ErrUnauthorized
	}

	return identity.AccessToken, nil
}

// rancherClusterName生成可路由且避免同名冲突的集群名称。
//
// :param cluster: Rancher集群。
// :returns: Headlamp集群名称。
func rancherClusterName(cluster rancher.Cluster) string {
	name := kubeconfig.MakeDNSFriendly(cluster.Name)
	if name == "" {
		return cluster.ID
	}

	return name + "--" + cluster.ID
}

// addRancherContext注册无共享凭证的集群代理。
//
// :param name: Headlamp集群名称。
// :param id: Rancher集群ID。
// :param sessionKey: 当前会话摘要，登录入口使用空字符串。
// :returns: 配置错误。
func (c *HeadlampConfig) addRancherContext(name, id, sessionKey string) error {
	c.rancher.mu.Lock()
	defer c.rancher.mu.Unlock()

	key := statelessContextKey(name, sessionKey)
	if _, err := c.KubeConfigStore.GetContext(key); err == nil {
		return nil
	} else if !errors.Is(err, cache.ErrNotFound) {
		return err
	}

	cluster := &kubeconfig.Context{
		Name: name, Internal: true, Source: kubeconfig.InCluster,
		KubeContext: &api.Context{Cluster: name, AuthInfo: name},
		Cluster: &api.Cluster{
			Server: c.rancher.client.ClusterServer(id), CertificateAuthorityData: []byte(c.OidcCACert),
		},
		AuthInfo: &api.AuthInfo{},
		OidcConf: &kubeconfig.OidcConfig{
			ClientID: c.OidcClientID, ClientSecret: c.OidcClientSecret,
			IdpIssuerURL: c.OidcIdpIssuerURL, Scopes: c.OidcScopes,
		},
	}
	if c.OidcCACert != "" {
		cluster.OidcConf.CACert = &c.OidcCACert
	}

	if err := cluster.SetupProxy(); err != nil {
		return fmt.Errorf("配置Rancher集群代理: %w", err)
	}

	if sessionKey == "" {
		return c.KubeConfigStore.AddContext(cluster)
	}

	return c.KubeConfigStore.AddContextWithKeyAndTTL(cluster, key, time.Duration(c.SessionTTL)*time.Second)
}

// completeRancherLogin在OIDC验证后建立服务端会话并返回集群列表。
//
// :param w: HTTP响应。
// :param r: 回调请求。
// :param login: 原始登录请求。
// :param token: 已验证的OIDC令牌。
func (c *HeadlampConfig) completeRancherLogin(
	w http.ResponseWriter, r *http.Request, login *OauthConfig, token *oauth2.Token,
) {
	id, identity, err := c.rancher.sessions.Start(r.Context(), token)
	if err != nil {
		logger.Log(logger.LevelError, nil, err, "创建Rancher登录会话")
		http.Error(w, "无法读取当前账号的Rancher集群", http.StatusBadGateway)

		return
	}

	for _, cluster := range identity.Clusters {
		if err := c.addRancherContext(rancherClusterName(cluster), cluster.ID, identity.SessionKey); err != nil {
			http.Error(w, "配置Rancher集群代理失败", http.StatusInternalServerError)
			return
		}
	}

	if previous, err := r.Cookie(rancherSessionCookie); err == nil {
		if err := c.rancher.sessions.Delete(r.Context(), previous.Value); err != nil {
			http.Error(w, "结束原登录会话失败", http.StatusInternalServerError)
			return
		}
	}

	c.setRancherCookie(w, r, id, c.SessionTTL)
	// 完整页面登录后展示全部集群；弹窗继续使用现有的完成通知。
	redirect := strings.TrimRight(c.BaseURL, "/") + "/"
	if login.Popup {
		redirect += "auth?cluster=" + url.QueryEscape(rancherClusterName(identity.Clusters[0])) + "&popup=true"
	}

	http.Redirect(w, r, redirect, http.StatusSeeOther)
}

// setRancherCookie设置仅含随机标识的HttpOnly会话Cookie。
//
// :param w: HTTP响应。
// :param r: 当前请求。
// :param id: 随机会话标识。
// :param maxAge: Cookie有效秒数，负数表示删除。
func (c *HeadlampConfig) setRancherCookie(w http.ResponseWriter, r *http.Request, id string, maxAge int) {
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // HTTPS使用Secure，本机回环HTTP由IsSecureContext判断。
		Name: rancherSessionCookie, Value: id,
		Path: strings.TrimRight(c.BaseURL, "/") + "/", MaxAge: maxAge,
		HttpOnly: true, Secure: auth.IsSecureContext(r), SameSite: http.SameSiteStrictMode,
	})
}

// rancherClusters仅向当前会话返回其可见集群。
//
// :param r: 当前请求。
// :returns: 用户集群列表或登录入口。
func (c *HeadlampConfig) rancherClusters(r *http.Request) []Cluster {
	identity, _ := r.Context().Value(rancherIdentityKey{}).(*rancher.Identity)
	if identity == nil {
		return []Cluster{{
			Name: c.rancher.login, AuthType: "oidc",
			Metadata: map[string]interface{}{"source": "incluster", "rancherSSO": true},
		}}
	}

	clusters := make([]Cluster, 0, len(identity.Clusters))
	for _, cluster := range identity.Clusters {
		clusters = append(clusters, Cluster{
			Name: rancherClusterName(cluster), Server: c.rancher.client.ClusterServer(cluster.ID), AuthType: "oidc",
			Metadata: map[string]interface{}{
				"source": "incluster", "rancherClusterID": cluster.ID, "rancherSSO": true,
				"rancherDisplayName": cluster.Name,
				"hideByDefault":      cluster.ID == "local" || strings.EqualFold(cluster.Name, "harbor"),
			},
		})
	}

	return clusters
}

// rancherMiddleware获取会话、发现集群并为请求附加当前用户令牌。
//
// :param next: Headlamp处理器。
// :returns: 会话处理器。
func (c *HeadlampConfig) rancherMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, strings.TrimRight(c.BaseURL, "/"))
		isConfig := path == "/config"

		isCluster := strings.HasPrefix(path, "/clusters/") || strings.HasPrefix(path, "/encoded-clusters/")
		if !isConfig && !isCluster && path != "/drain-node" && path != "/drain-node-status" && path != "/wsMultiplexer" {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Cache-Control", "no-store")

		cookie, cookieErr := r.Cookie(rancherSessionCookie)
		if isCluster && (strings.HasSuffix(path, "/clear-token") || strings.HasSuffix(path, "/oidc-logout")) {
			c.endRancherSession(w, r, cookie, path)
			return
		}

		if cookieErr != nil {
			if isConfig {
				next.ServeHTTP(w, r)
			} else {
				http.Error(w, "请先通过Rancher登录", http.StatusUnauthorized)
			}

			return
		}

		identity, err := c.rancher.sessions.Identity(r.Context(), cookie.Value, isConfig)
		if err != nil {
			c.respondToRancherSessionError(w, r, next, isConfig, err)
			return
		}

		if !isConfig && path != "/wsMultiplexer" && !rancherCanAccess(path, r.URL.Query(), identity.Clusters) {
			http.Error(w, "当前账号无法访问此集群", http.StatusForbidden)
			return
		}

		for _, cluster := range identity.Clusters {
			if err := c.addRancherContext(rancherClusterName(cluster), cluster.ID, identity.SessionKey); err != nil {
				http.Error(w, "配置Rancher集群代理失败", http.StatusInternalServerError)
				return
			}
		}

		if isCluster {
			// 集群代理只接收当前会话身份，浏览器会话标识保留在Headlamp。
			r.Header.Del("Cookie")
		}

		r.Header.Set("Authorization", "Bearer "+identity.AccessToken)
		r = r.WithContext(context.WithValue(r.Context(), rancherIdentityKey{}, identity))
		next.ServeHTTP(w, r)
	})
}

// respondToRancherSessionError在会话失效时清理Cookie，并允许配置接口返回登录入口。
//
// :param w: HTTP响应。
// :param r: HTTP请求。
// :param next: Headlamp处理器。
// :param isConfig: 请求是否读取应用配置。
// :param err: 会话读取失败的原因。
func (c *HeadlampConfig) respondToRancherSessionError(
	w http.ResponseWriter, r *http.Request, next http.Handler, isConfig bool, err error,
) {
	if !errors.Is(err, rancher.ErrUnauthorized) {
		http.Error(w, "读取Rancher会话失败", http.StatusBadGateway)

		return
	}

	c.setRancherCookie(w, r, "", -1)

	if isConfig {
		next.ServeHTTP(w, r)

		return
	}

	http.Error(w, "Rancher登录会话已失效", http.StatusUnauthorized)
}

// rancherCanAccess匹配请求目标与当前用户的集群列表。
//
// :param path: 去除BaseURL后的请求路径。
// :param query: 查询参数。
// :param clusters: 用户可见集群。
// :returns: 是否允许请求目标。
func rancherCanAccess(path string, query url.Values, clusters []rancher.Cluster) bool {
	name := query.Get("cluster")
	if strings.HasPrefix(path, "/clusters/") {
		name, _, _ = strings.Cut(strings.TrimPrefix(path, "/clusters/"), "/")
	} else if strings.HasPrefix(path, "/encoded-clusters/") {
		encoded, _, _ := strings.Cut(strings.TrimPrefix(path, "/encoded-clusters/"), "/")

		var err error

		name, err = auth.DecodeClusterFromURL(encoded)
		if err != nil {
			return false
		}
	}

	for _, cluster := range clusters {
		if name == rancherClusterName(cluster) {
			return true
		}
	}

	return false
}

// endRancherSession使当前会话在全部集群退出。
//
// :param w: HTTP响应。
// :param r: 退出请求。
// :param cookie: 当前会话Cookie。
// :param path: 请求路径。
func (c *HeadlampConfig) endRancherSession(w http.ResponseWriter, r *http.Request, cookie *http.Cookie, path string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "需要POST请求", http.StatusMethodNotAllowed)

		return
	}

	if cookie != nil {
		if err := c.rancher.sessions.Delete(r.Context(), cookie.Value); err != nil {
			http.Error(w, "退出Rancher会话失败", http.StatusInternalServerError)
			return
		}
	}

	c.setRancherCookie(w, r, "", -1)

	if strings.HasSuffix(path, "/oidc-logout") {
		sendOIDCLogoutRedirect(w, r, strings.TrimRight(c.BaseURL, "/")+"/?logout=true")
	} else {
		w.WriteHeader(http.StatusOK)
	}
}
