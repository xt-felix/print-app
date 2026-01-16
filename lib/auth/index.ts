// 类型导出

// 配置导出
export { authRoutes, cookieConfig, logtoConfig, shouldEnforceAuth } from './config';
// 核心认证方法导出
export { getUser, handleCallback, logtoClient, requireAuth, requireUser, signIn, signOut } from './logto';

// 会话管理导出
export {
  clearLogtoSession,
  clearVirtualUser,
  getAuthError,
  getLogtoSession,
  getVirtualUser,
  setAuthError,
  setLogtoSession,
  setVirtualUser,
} from './session';
export type {
  AuthContext,
  LogtoConfig,
  LogtoUser,
  MockUser,
  RequireAuthOptions,
  UserInfo,
  VirtualUser,
} from './types';
