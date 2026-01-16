# 数据库表结构设计说明

## 概述

本项目使用 Prisma 7 + SQLite 作为数据库方案，为一个 **AI 聊天应用**（AI 代码生成/网页设计工具）提供数据存储支持。

---

## 表关系图

```
┌─────────────┐     1:N      ┌─────────────┐     1:1      ┌─────────────┐
│    Chat     │─────────────→│   Message   │─────────────→│    Page     │
└─────────────┘              └─────────────┘              └─────────────┘
      │                            │
      │ 1:N                        │ 1:N
      ▼                            ▼
┌─────────────┐              ┌─────────────┐
│ Deployment  │              │   Section   │
└─────────────┘              └─────────────┘

┌─────────────┐              ┌─────────────┐
│  ChatUsage  │              │ UserSetting │
└─────────────┘              └─────────────┘
   (独立表)                     (独立表)
```

---

## 表结构详解

### 1. Chat（聊天会话）

存储用户的聊天会话信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `urlId` | String? | URL 标识符，用于生成可分享的短链接 |
| `userId` | String | 用户 ID |
| `description` | String? | 聊天描述/标题 |
| `timestamp` | DateTime | 时间戳 |
| `version` | Int | 版本号，用于乐观锁 |
| `metadata` | Json? | 扩展信息（gitUrl、gitBranch、netlifySiteId） |

**设计原因：**
- `urlId`：与内部 `id` 分离，支持生成友好的可分享链接（如 `/chat/abc123`）
- `version`：乐观锁机制，防止并发更新冲突
- `metadata`：JSON 字段存储扩展信息，避免频繁修改表结构

**索引：** `userId`、`urlId`

---

### 2. Message（消息）

存储聊天中的每条消息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `chatId` | String | 所属聊天 ID |
| `userId` | String | 所属用户 ID |
| `role` | String | 角色：`user` 或 `assistant` |
| `content` | String | 消息内容 |
| `revisionId` | String? | 版本 ID，用于消息编辑历史 |
| `annotations` | Json? | 消息内的标注信息 |
| `isDiscarded` | Boolean | 是否为遗弃消息（软删除） |
| `metadata` | Json? | 消息的元数据 |
| `parts` | Json? | AI SDK 的 UIMessage 结构化内容 |
| `version` | Int | 版本号 |

**设计原因：**
- `role`：区分用户消息和 AI 回复
- `parts`：存储 AI SDK 的 UIMessage 结构化内容（文本、代码块、工具调用等）
- `isDiscarded`：软删除机制，保留历史但不显示（支持消息分支/重新生成）
- `revisionId`：支持消息版本管理

**关联：**
- 属于一个 `Chat`（级联删除）
- 可关联一个 `Page`
- 可关联多个 `Section`

**索引：** `chatId`、`userId`

---

### 3. Page（页面数据）

存储 AI 生成的完整页面快照。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `messageId` | String | 关联的消息 ID（唯一） |
| `pages` | Json | 页面数据数组，自定义编辑器的页面数据结构 |

**设计原因：**
- 与 Message 一对一关联，表示 AI 生成的完整页面快照
- 使用 JSON 数组存储多页面数据，支持复杂的编辑器结构

**索引：** `messageId`

---

### 4. Section（页面片段）

存储 AI 对页面的增量修改操作。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `messageId` | String | 所属消息 ID |
| `type` | String | 类型，通常为 `section` |
| `action` | String | 操作类型：`add`、`update`、`remove` |
| `actionId` | String | 操作的唯一标识 |
| `pageName` | String | 页面名称 |
| `content` | String | Section 内容（HTML/CSS） |
| `domId` | String | DOM 元素 ID |
| `rootDomId` | String? | 父级容器 DOM ID |
| `sort` | Int | 排序顺序 |

**设计原因：**
- `action`：记录操作类型，支持**增量更新**而非整页替换
- `domId` / `rootDomId`：精确定位 DOM 元素，支持局部修改
- `sort`：保持 Section 的正确顺序
- `pageName`：支持多页面项目

**这种设计的优势：**
1. AI 可以逐步构建页面（流式输出）
2. 支持增量修改，提升性能
3. 保留修改历史，可追溯每次变更

**索引：** `messageId`、`domId`、`rootDomId`

---

### 5. ChatUsage（使用量统计）

记录每次 AI 调用的 token 消耗。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `userId` | String | 用户 ID |
| `chatId` | String | 聊天 ID |
| `messageId` | String | 消息 ID |
| `inputTokens` | Int | 输入令牌数 |
| `outputTokens` | Int | 输出令牌数 |
| `cachedTokens` | Int | 缓存令牌数 |
| `reasoningTokens` | Int | 推理令牌数 |
| `totalTokens` | Int | 总令牌数 |
| `calledAt` | DateTime | 调用时间 |
| `status` | String | 调用状态 |
| `modelName` | String? | 使用的模型名称 |
| `prompt` | String? | 提示文本 |
| `metadata` | Json? | 额外调用信息 |

**设计原因：**
- 详细记录每次 AI 调用的 token 消耗
- 分离不同类型的 token：支持精确计费（不同 token 类型价格不同）
- 多个索引：支持按用户、时间、状态等维度快速查询统计

**索引：** `userId`、`messageId`、`chatId`、`calledAt`、`status`

---

### 6. Deployment（部署记录）

记录用户将代码部署到各平台的信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `userId` | String | 用户 ID |
| `chatId` | String | 聊天 ID |
| `platform` | String | 部署平台（1Panel、Netlify、Vercel） |
| `deploymentId` | String | 平台上的部署 ID |
| `url` | String | 部署后的访问链接 |
| `status` | String | 部署状态 |
| `metadata` | Json? | 平台特定信息 |

**设计原因：**
- 支持多平台部署（1Panel、Netlify、Vercel 等）
- `@@unique([platform, deploymentId])`：确保同一平台的部署 ID 唯一
- `metadata`：存储各平台特定的配置信息

**索引：** `userId`、`chatId`、`platform`、`status`、`createdAt`

---

### 7. UserSetting（用户设置）

存储用户的各种设置，采用 KV 存储模式。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | 主键，UUID |
| `userId` | String | 用户 ID |
| `category` | String | 设置类别（profile、connectivity、services） |
| `key` | String | 设置键名 |
| `value` | String | 设置值 |
| `isSecret` | Boolean | 是否为敏感信息（如 API 密钥） |

**设计原因：**
- **KV 存储模式**：`category + key + value` 组合，灵活存储任意设置项
- `isSecret`：标记敏感信息，便于加密处理或脱敏显示
- `@@unique([userId, category, key])`：确保每个用户的每个设置项唯一

**索引：** `userId`、`category`、`key`、`isSecret`

---

## 设计特点总结

| 特点 | 实现方式 |
|------|----------|
| **扩展性** | 大量使用 `Json` 类型的 `metadata` 字段，无需频繁改表 |
| **性能优化** | 关键查询字段都建立了索引 |
| **数据完整性** | 外键约束 + `onDelete: Cascade` 级联删除 |
| **软删除** | `isDiscarded` 标记删除而非物理删除 |
| **并发控制** | `version` 字段实现乐观锁机制 |
| **审计追踪** | 所有表都有 `createdAt` / `updatedAt` 时间戳 |
| **灵活配置** | UserSetting 采用 KV 模式，支持任意配置项 |

---

## 典型查询场景

### 获取用户的聊天列表
```typescript
prisma.chat.findMany({
  where: { userId },
  orderBy: { timestamp: 'desc' }
})
```

### 获取聊天的所有消息
```typescript
prisma.message.findMany({
  where: { chatId, isDiscarded: false },
  include: { page: true, sections: true }
})
```

### 统计用户的 token 使用量
```typescript
prisma.chatUsage.aggregate({
  where: { userId },
  _sum: { totalTokens: true }
})
```

### 获取用户设置
```typescript
prisma.userSetting.findMany({
  where: { userId, category: 'services' }
})
```





# Prisma 7 安装和使用流程指南

## 📦 一、安装依赖

### 1. 安装 Prisma CLI 和 Client

```bash
pnpm add prisma @prisma/client -D
```

### 2. 安装数据库驱动（以 SQLite + better-sqlite3 为例）

```bash
pnpm add @prisma/adapter-better-sqlite3 better-sqlite3
pnpm add -D @types/better-sqlite3
```

**其他数据库的适配器：**
- PostgreSQL: `@prisma/adapter-pg` + `pg`
- MySQL: `@prisma/adapter-mysql2` + `mysql2`
- MongoDB: `@prisma/adapter-mongodb` + `mongodb`

---

## 🚀 二、初始化 Prisma

### 1. 初始化 Prisma 项目

```bash
pnpm prisma init --datasource-provider sqlite
```

这会创建：
- `prisma/schema.prisma` - 数据模型定义文件
- `.env` - 环境变量文件（可选，Prisma 7 中不再必需）

---

## 📝 三、配置 Prisma 7（重要！）

### 1. 配置 `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  // ⚠️ Prisma 7 中不再在 schema 中配置 url
}
```

### 2. 创建 `prisma.config.ts`（Prisma 7 必需）

```typescript
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL || 'file:./prisma/your-database.db',
  },
})
```

**⚠️ 重要：** Prisma 7 中，`prisma migrate` 和 `prisma db push` 命令需要从 `prisma.config.ts` 读取数据库 URL，而不是从 `schema.prisma`。

---

## 🗄️ 四、定义数据模型

在 `prisma/schema.prisma` 中定义你的数据模型：

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## 🔧 五、创建 Prisma Client 实例

创建 `lib/prisma.ts`（或 `src/lib/prisma.ts`）：

```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

declare global {
  var prisma: PrismaClient | undefined
}

// 配置 adapter（Prisma 7 新特性）
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/your-database.db'
})

// 创建 Prisma Client 实例
export const prisma = globalThis.prisma ?? new PrismaClient({ adapter })

// 开发环境下避免热重载时创建多个实例
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma
}
```

**关键点：**
- ✅ 使用 `adapter` 配置数据库连接（Prisma 7 新特性）
- ✅ 使用 `globalThis` 避免开发环境重复创建实例
- ✅ 使用 `declare global` 扩展类型（避免使用 `as` 类型断言）

---

## 🗃️ 六、生成 Prisma Client

```bash
pnpm prisma generate
```

这会根据你的 schema 生成类型安全的 Prisma Client。

---

## 📊 七、数据库迁移

### 方式一：使用 `prisma db push`（开发环境推荐）

```bash
pnpm prisma db push
```

- ✅ 快速同步 schema 到数据库
- ✅ 适合开发环境
- ⚠️ 不会创建迁移历史

### 方式二：使用 `prisma migrate`（生产环境推荐）

```bash
# 创建迁移
pnpm prisma migrate dev --name init

# 查看迁移状态
pnpm prisma migrate status

# 应用迁移（生产环境）
pnpm prisma migrate deploy
```

- ✅ 创建迁移历史
- ✅ 适合团队协作和生产环境
- ✅ 可以回滚迁移

---

## 🎨 八、使用 Prisma Studio（可视化数据库）

```bash
pnpm prisma studio
```

访问 http://localhost:5555 查看和管理数据库。

---

## 💻 九、在代码中使用 Prisma

```typescript
import { prisma } from '@/lib/prisma'

// 查询
const users = await prisma.user.findMany()

// 创建
const user = await prisma.user.create({
  data: {
    email: 'user@example.com',
    name: 'John Doe'
  }
})

// 更新
const updatedUser = await prisma.user.update({
  where: { id: 'user-id' },
  data: { name: 'Jane Doe' }
})

// 删除
await prisma.user.delete({
  where: { id: 'user-id' }
})
```

---

## 🔑 十、多项目配置（避免数据混淆）

### 问题
多个项目使用相同的数据库路径会导致数据混淆。

### 解决方案

**1. 为每个项目配置不同的数据库文件**

在 `prisma.config.ts` 中：
```typescript
datasource: {
  url: process.env.DATABASE_URL || 'file:./prisma/项目名.db',
}
```

在 `lib/prisma.ts` 中：
```typescript
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/项目名.db'
})
```

**2. 使用环境变量**

创建 `.env` 文件：
```bash
DATABASE_URL="file:./prisma/your-project.db"
```

**3. 在 `.gitignore` 中忽略数据库文件**

```
/prisma/*.db
/prisma/*.db-journal
```

---

## 📋 十一、常用命令总结

```bash
# 验证 schema
pnpm prisma validate

# 格式化 schema
pnpm prisma format

# 生成 Prisma Client
pnpm prisma generate

# 同步 schema 到数据库（开发）
pnpm prisma db push

# 创建迁移
pnpm prisma migrate dev

# 应用迁移（生产）
pnpm prisma migrate deploy

# 打开 Prisma Studio
pnpm prisma studio

# 重置数据库（⚠️ 会删除所有数据）
pnpm prisma migrate reset
```

---

## ⚠️ 十二、Prisma 7 重要变化

1. **不再在 `schema.prisma` 中配置 `url`**
   - 需要在 `prisma.config.ts` 中配置

2. **必须使用 Adapter**
   - 使用 `@prisma/adapter-*` 包配置数据库连接
   - 在创建 `PrismaClient` 时传入 `adapter`

3. **迁移命令需要 `prisma.config.ts`**
   - `prisma migrate` 和 `prisma db push` 需要从 `prisma.config.ts` 读取配置

4. **类型安全**
   - 避免使用 `as` 类型断言
   - 使用 `declare global` 扩展类型

---

## 🎯 完整流程示例

```bash
# 1. 安装依赖
pnpm add prisma @prisma/client @prisma/adapter-better-sqlite3 better-sqlite3
pnpm add -D @types/better-sqlite3

# 2. 初始化
pnpm prisma init --datasource-provider sqlite

# 3. 配置 prisma.config.ts（必需）

# 4. 定义 schema.prisma

# 5. 创建 lib/prisma.ts

# 6. 生成客户端
pnpm prisma generate

# 7. 同步数据库
pnpm prisma db push

# 8. 开始使用
# 在代码中导入 prisma 并使用
```

---

## 📚 参考资源

- [Prisma 官方文档](https://www.prisma.io/docs)
- [Prisma 7 升级指南](https://www.prisma.io/docs/orm/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [Prisma Client API 参考](https://www.prisma.io/docs/orm/reference/prisma-client-reference)
