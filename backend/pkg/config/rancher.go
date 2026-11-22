// 文件描述：校验Rancher单点登录与用户权限代理配置。
// 项目名称：Headlamp BBT
// 文件名称：rancher.go
// 作者：Codex
// 日期：2026-11-19

package config

import (
	"errors"
	"net/url"
	"strings"
)

// validateRancher检查独立登录模式所需配置。
//
// :returns: 配置错误；配置有效时返回nil。
func (c *Config) validateRancher() error {
	if c.RancherURL == "" {
		return nil
	}
	server, err := url.Parse(c.RancherURL)
	if err != nil || server.Scheme != "https" || server.Hostname() == "" ||
		server.User != nil || server.RawQuery != "" || server.Fragment != "" ||
		strings.Trim(server.Path, "/") != "" {
		return errors.New("rancher-url requires an HTTPS origin without credentials, path, query or fragment")
	}
	c.RancherURL = strings.TrimRight(c.RancherURL, "/")
	if c.OidcIdpIssuerURL != c.RancherURL+"/oidc" {
		return errors.New("Rancher OIDC issuer must equal rancher-url followed by /oidc")
	}
	if !c.OidcUseCookie || !c.OidcUseAccessToken || !c.OidcUsePKCE ||
		strings.TrimSpace(c.InClusterContextName) == "" ||
		strings.TrimSpace(c.OidcClientID) == "" || strings.TrimSpace(c.OidcClientSecret) == "" ||
		strings.TrimSpace(c.OidcCallbackURL) == "" {
		return errors.New("Rancher requires OIDC cookies, access tokens, PKCE, context name, client ID, client secret and callback URL")
	}
	if c.UnsafeUseServiceAccountToken || c.InsecureSsl || c.OidcSkipTLSVerify ||
		c.KubeConfigPath != "" || c.EnableDynamicClusters || c.EnableClusterInventory ||
		c.ProxyAuthEnabled || c.OidcUseTokenBroadcast || c.OidcValidatorIdpIssuerURL != "" || c.OidcValidatorClientID != "" {
		return errors.New("Rancher requires verified TLS and exclusive user session authentication")
	}
	return nil
}
