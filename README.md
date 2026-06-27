# 投资笔记

一个用于记录基金持仓、交易、定投和收益的投资管理工具。项目基于 Next.js，账号密码登录，数据同步到 PostgreSQL。

## 运行

```bash
npm install --legacy-peer-deps
npm run dev
```

默认开发地址：

```text
http://localhost:3000
```

## 环境变量

复制 `env.example` 为 `.env.local`，并填写数据库连接：

```env
DB_HOST=120.46.220.39
DB_PORT=5432
DB_USER=invest
DB_PASSWORD=your_password
DB_NAME=invest
AUTH_SECRET=change_this_to_a_long_random_string
```

当前本地 `.env.local` 已配置为指定 PostgreSQL 数据库。账号不存在时，登录会自动创建账号。

## 数据导入

从旁边的 Go `backend` 项目导入历史数据：

```bash
npm run import:backend
```

脚本会读取 `../backend/.env` 的 MySQL 连接，将用户、基金、持仓、交易、定投和收益快照转换为当前项目的云同步数据，写入 PostgreSQL 的 `users` 与 `user_configs` 表。

## 部署

项目需要 Next.js 服务端运行，不能使用纯静态部署。

```bash
npm run build
npm run start
```

Docker：

```bash
docker compose up -d --build
```
