// 文件描述：管理Rancher用户会话、令牌刷新及可见集群。
// 项目名称：Headlamp BBT
// 文件名称：session.go
// 作者：Codex
// 日期：2026-11-19

package rancher

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/kubernetes-sigs/headlamp/backend/pkg/cache"
	"golang.org/x/oauth2"
)

type session struct {
	mu       sync.Mutex
	token    *oauth2.Token
	clusters []Cluster
}

// Identity包含仅供后端使用的用户身份及集群列表。
type Identity struct {
	SessionKey  string
	AccessToken string
	Clusters    []Cluster
}

// Sessions把用户令牌保存在服务端内存，通过随机会话标识关联浏览器。
type Sessions struct {
	client *Client
	oauth  oauth2.Config
	store  cache.Cache[*session]
	ttl    time.Duration
}

// NewSessions创建会话管理器。
//
// :param client: Rancher客户端。
// :param clientID: OIDC客户端ID。
// :param clientSecret: OIDC客户端密钥。
// :param ttl: 浏览器登录会话有效期。
// :returns: 会话管理器。
func NewSessions(client *Client, clientID, clientSecret string, ttl time.Duration) *Sessions {
	return &Sessions{
		client: client,
		oauth: oauth2.Config{
			ClientID: clientID, ClientSecret: clientSecret,
			Endpoint: oauth2.Endpoint{TokenURL: client.server + "/oidc/token"},
		},
		store: cache.New[*session](),
		ttl:   ttl,
	}
}

// Start在真实集群发现成功后创建会话。
//
// :param ctx: 请求上下文。
// :param token: 完成OIDC交换的用户令牌。
// :returns: 随机会话标识、用户身份或请求错误。
func (s *Sessions) Start(ctx context.Context, token *oauth2.Token) (string, *Identity, error) {
	if token == nil || token.AccessToken == "" || token.RefreshToken == "" || token.Expiry.IsZero() {
		return "", nil, errors.New("Rancher login requires access token, refresh token and expiry")
	}

	clusters, err := s.client.Clusters(ctx, token.AccessToken)
	if err != nil {
		return "", nil, err
	}

	if len(clusters) == 0 {
		return "", nil, errors.New("当前Rancher账号没有可访问的集群")
	}

	id := rand.Text()
	stored := &session{token: token, clusters: clusters}

	key := sessionKey(id)
	if err := s.store.SetWithTTL(ctx, key, stored, s.ttl); err != nil {
		return "", nil, err
	}

	return id, &Identity{
		SessionKey: key, AccessToken: token.AccessToken, Clusters: append([]Cluster(nil), clusters...),
	}, nil
}

// Identity读取会话，并由OAuth2客户端按过期时间刷新访问令牌。
//
// :param ctx: 请求上下文。
// :param id: 随机会话标识。
// :param discover: 是否重新获取当前可见集群。
// :returns: 用户身份或请求错误。
func (s *Sessions) Identity(ctx context.Context, id string, discover bool) (*Identity, error) {
	return s.IdentityByKey(ctx, sessionKey(id), discover)
}

// IdentityByKey供后端长连接按不可用作Cookie的会话摘要更新身份。
//
// :param ctx: 请求上下文。
// :param key: 服务端已验证的会话摘要。
// :param discover: 是否重新发现集群。
// :returns: 用户身份或请求错误。
func (s *Sessions) IdentityByKey(ctx context.Context, key string, discover bool) (*Identity, error) {
	stored, err := s.store.Get(ctx, key)
	if err != nil {
		if errors.Is(err, cache.ErrNotFound) {
			return nil, ErrUnauthorized
		}

		return nil, err
	}

	stored.mu.Lock()
	defer stored.mu.Unlock()

	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.client.http)

	token, err := s.oauth.TokenSource(ctx, stored.token).Token()
	if err != nil {
		return nil, fmt.Errorf("%w: Rancher令牌刷新失败，请重新登录", ErrUnauthorized)
	}

	stored.token = token
	if discover {
		clusters, err := s.client.Clusters(ctx, token.AccessToken)
		if err != nil {
			return nil, err
		}

		stored.clusters = clusters
	}

	return &Identity{
		SessionKey:  key,
		AccessToken: token.AccessToken,
		Clusters:    append([]Cluster(nil), stored.clusters...),
	}, nil
}

// Delete结束一次Headlamp登录，所有集群立即共用此失效状态。
//
// :param ctx: 请求上下文。
// :param id: 随机会话标识。
// :returns: 存储错误。
func (s *Sessions) Delete(ctx context.Context, id string) error {
	return s.store.Delete(ctx, sessionKey(id))
}

// sessionKey为内部连接生成不可反向用作会话Cookie的摘要。
//
// :param id: 浏览器随机会话标识。
// :returns: SHA-256摘要。
func sessionKey(id string) string {
	digest := sha256.Sum256([]byte(id))
	return hex.EncodeToString(digest[:])
}

// Close释放会话存储。
//
// :returns: 存储关闭错误。
func (s *Sessions) Close() error { return s.store.Close() }
