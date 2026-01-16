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
