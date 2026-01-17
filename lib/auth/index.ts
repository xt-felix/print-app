// 类型导出

// 认证方法导出
export {
  // 配置
  authConfig,
  clearLogtoSession,
  clearVirtualUser,
  getAuthError,
  getLogtoSession,
  // 核心方法
  getUser,
  getVirtualUser,
  handleCallback,
  // 客户端实例
  logtoClient,
  requireAuth,
  requireUser,
  setAuthError,
  // Session 管理
  setLogtoSession,
  setVirtualUser,
  shouldEnforceAuth,
  // 认证操作
  signIn,
  signOut,
} from './auth';
export type {
  AuthContext,
  LogtoConfig,
  LogtoSsoIdentity,
  LogtoUser,
  LogtoUserIdentity,
  LogtoUserProfile,
  MockUser,
  RequireAuthOptions,
  UserInfo,
  VirtualUser,
} from './types';
