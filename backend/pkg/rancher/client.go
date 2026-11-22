// 文件描述：使用当前用户身份读取Rancher可访问集群。
// 项目名称：Headlamp BBT
// 文件名称：client.go
// 作者：Codex
// 日期：2026-11-19

package rancher

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/util/validation"
)

// ErrUnauthorized表示Rancher拒绝当前用户令牌。
var ErrUnauthorized = errors.New("rancher session is unauthorized")

// Cluster保存Rancher返回的集群标识与显示名称。
type Cluster struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Client通过经过证书校验的连接访问指定Rancher。
type Client struct {
	server string
	http   *http.Client
}

// NewClient创建Rancher客户端并加载可选的PEM根证书。
//
// :param server: Rancher HTTPS地址。
// :param caPEM: 附加根证书的PEM内容。
// :returns: 客户端或配置错误。
func NewClient(server, caPEM string) (*Client, error) {
	origin, err := url.Parse(server)
	if err != nil || origin.Scheme != "https" || origin.Hostname() == "" || origin.User != nil ||
		strings.Trim(origin.Path, "/") != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return nil, errors.New("Rancher requires an HTTPS origin")
	}

	roots, err := x509.SystemCertPool()
	if err != nil {
		return nil, fmt.Errorf("读取系统根证书: %w", err)
	}

	if caPEM != "" && !roots.AppendCertsFromPEM([]byte(caPEM)) {
		return nil, errors.New("Rancher CA contains no valid PEM certificates")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}

	return &Client{
		server: strings.TrimRight(server, "/"),
		http: &http.Client{
			Transport: transport,
			Timeout:   20 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

// Server返回当前Rancher地址。
//
// :returns: HTTPS地址。
func (c *Client) Server() string { return c.server }

// ClusterServer返回集群的Rancher Kubernetes代理地址。
//
// :param id: Rancher集群ID。
// :returns: 集群代理地址。
func (c *Client) ClusterServer(id string) string {
	return c.server + "/k8s/clusters/" + url.PathEscape(id)
}

// Clusters读取当前令牌可访问的全部集群，并跟随同源分页链接。
//
// :param ctx: 请求上下文。
// :param token: 当前用户的访问令牌。
// :returns: 用户集群列表或请求错误。
func (c *Client) Clusters(ctx context.Context, token string) ([]Cluster, error) {
	if token == "" {
		return nil, ErrUnauthorized
	}

	next := c.server + "/v3/clusters?limit=1000"
	visited := map[string]bool{}
	byID := map[string]Cluster{}

	for next != "" {
		if visited[next] {
			return nil, errors.New("Rancher returned a repeated cluster pagination link")
		}

		visited[next] = true

		page, err := c.clusterPage(ctx, token, next)
		if err != nil {
			return nil, err
		}

		for _, cluster := range page.Data {
			if len(validation.IsDNS1123Subdomain(cluster.ID)) != 0 {
				return nil, errors.New("Rancher returned an invalid cluster ID")
			}

			byID[cluster.ID] = cluster
		}

		next = page.Pagination.Next
		if next != "" {
			base, _ := url.Parse(c.server)

			reference, err := url.Parse(next)
			if err != nil {
				return nil, errors.New("Rancher returned an invalid pagination URL")
			}

			resolved := base.ResolveReference(reference)
			if resolved.Scheme != base.Scheme || resolved.Host != base.Host || resolved.User != nil ||
				resolved.Path != "/v3/clusters" || resolved.Fragment != "" {
				return nil, errors.New("Rancher returned a pagination URL outside the cluster API")
			}

			next = resolved.String()
		}
	}

	clusters := make([]Cluster, 0, len(byID))
	for _, cluster := range byID {
		clusters = append(clusters, cluster)
	}

	sort.Slice(clusters, func(i, j int) bool { return clusters[i].ID < clusters[j].ID })

	return clusters, nil
}

type clusterPage struct {
	Data       []Cluster `json:"data"`
	Pagination struct {
		Next string `json:"next"`
	} `json:"pagination"`
}

// clusterPage读取单页响应，错误中保留状态码并避免包含响应凭证。
//
// :param ctx: 请求上下文。
// :param token: 当前用户访问令牌。
// :param endpoint: 已校验的同源API地址。
// :returns: 解码结果或请求错误。
func (c *Client) clusterPage(ctx context.Context, token, endpoint string) (*clusterPage, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("请求Rancher集群列表: %w", err)
	}

	defer func() { _ = response.Body.Close() }()

	if response.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Rancher cluster API returned HTTP %d", response.StatusCode)
	}

	var page clusterPage
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		return nil, fmt.Errorf("解析Rancher集群列表: %w", err)
	}

	return &page, nil
}
