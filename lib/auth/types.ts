import type { IdTokenClaims } from '@logto/next';

// ============================================
// Logto 用户类型
// ============================================

export interface LogtoUserIdentity {
  userId: string;
  details: Record<string, unknown>;
}

export interface LogtoUserAddress {
  formatted?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface LogtoUserProfile {
  familyName?: string;
  givenName?: string;
  middleName?: string;
  nickname?: string;
  preferredUsername?: string;
  profile?: string;
  website?: string;
  gender?: string;
  birthdate?: string;
  zoneinfo?: string;
  locale?: string;
  address?: LogtoUserAddress;
}

export interface LogtoSsoIdentity {
  tenantId: string;
  id: string;
  userId: string;
  issuer: string;
  identityId: string;
  detail: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  ssoConnectorId: string;
}

export interface LogtoUser {
  id: string;
  username: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  name: string | null;
  avatar: string | null;
  customData: Record<string, unknown>;
  identities: Record<string, LogtoUserIdentity>;
  lastSignInAt: number | null;
  createdAt: number;
  updatedAt: number;
  profile: LogtoUserProfile;
  applicationId: string | null;
  isSuspended: boolean;
  hasPassword?: boolean;
  ssoIdentities?: LogtoSsoIdentity[];
}

// ============================================
// 认证上下文类型
// ============================================

export interface AuthContext {
  isAuthenticated: boolean;
  isMock?: boolean;
  isVirtual?: boolean;
  userInfo?: IdTokenClaims;
  claims?: IdTokenClaims;
}

export interface MockUser extends AuthContext {
  isMock: true;
}

export interface VirtualUser extends AuthContext {
  isVirtual: true;
}

// ============================================
// 配置类型
// ============================================

export interface LogtoConfig {
  endpoint: string;
  appId: string;
  appSecret: string;
  baseUrl: string;
  cookieSecret: string;
  scopes: string[];
}

export interface RequireAuthOptions {
  isApi?: boolean;
  redirectTo?: string;
}

// ============================================
// Session 数据类型
// ============================================

export interface UserInfo {
  iss?: string;
  sub: string;
  aud?: string;
  exp?: number;
  iat?: number;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  username?: string | null;
  picture?: string | null;
}

export interface VirtualUserSession {
  isAuthenticated: boolean;
  isVirtual: boolean;
  userInfo: UserInfo;
  lastVerified: number;
}

export interface LogtoSession {
  isAuthenticated: boolean;
  accessToken?: string;
  idToken?: string;
  userInfo?: UserInfo;
}
