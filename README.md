# privy-tg-test

最小可运行的 Privy × Telegram Mini App 登录验证 demo。页面空白、只做登录这一件事，把每一步成功 / 失败都 toast 出来，用于独立定位 Privy + TG 链路问题，不接任何业务后端。

- 线上 URL（GitHub Pages）: `https://errancel.github.io/ErranceL-privy-tg-test/`
- 本地 URL: `http://localhost:5173/`

## 技术栈

- Vite + React 19 + TypeScript
- `@privy-io/react-auth@^3.22.1`（内置 TG Mini App 登录）
- 自研 toast（`src/toast.ts` + `src/Toaster.tsx`，module-scope listener）
- GitHub Actions 自动部署到 GitHub Pages

## 项目结构

```
.
├─ .github/workflows/deploy.yml   push main 触发 build + deploy-pages
├─ index.html                     引 telegram-web-app.js
├─ .env.local                     VITE_PRIVY_APP_ID（不 commit）
├─ vite.config.ts                 base 按环境切：build 时 /ErranceL-privy-tg-test/，dev 时 /
└─ src/
   ├─ main.tsx                    PrivyProvider 挂根 + fail-fast env
   ├─ App.tsx                     登录 / 登出 / 会话恢复 / 调试面板
   ├─ Toaster.tsx                 右上角 fixed toast 面板（错误 toast 不自动消失）
   └─ toast.ts                    emitToast / onToast
```

## 一、前置配置

### 1. Privy Dashboard

在 [https://dashboard.privy.io](https://dashboard.privy.io) 打开 SIT App：

- **User management → Authentication → Login methods → Socials**
  - 打开 **Telegram**
  - 填 **Bot Token**（BotFather 给的那串 `1234567890:AzBy…`）
  - 填 **Bot handle**（`@privy_tg_demo_bot`）
- **Configuration → App settings → Domains**，Allowed Origins 加三条：
  - `https://errancel.github.io`
  - `https://web.telegram.org`
  - `http://web.telegram.org`
  - 本地开发时另加 `http://localhost:5173`（widget 降级调试用）
- 从 App 设置页抄 **App ID**（`cm...`）

### 2. GitHub 仓库

- 仓库：`ErranceL/privy-tg-test`
- **Settings → Pages → Source** = `GitHub Actions`
- **Settings → Secrets and variables → Actions → New repository secret**
  - Name: `VITE_PRIVY_APP_ID`
  - Value: Privy App ID

### 3. Telegram BotFather

在 [@BotFather](https://t.me/BotFather)：

- `/setdomain` → 选 bot → 填 `errancel.github.io`
- `/setmenubutton` → 选 bot → URL 填 `https://errancel.github.io/ErranceL-privy-tg-test/`、按钮文案 `Open`

## 二、本地开发

```bash
pnpm install
echo 'VITE_PRIVY_APP_ID=cm...' > .env.local
pnpm dev
```

浏览器打开 `http://localhost:5173/`，点 **Log in with Telegram**：

- 在普通浏览器里是 **Telegram Login Widget 降级路径**（弹 Telegram OAuth 窗，扫二维码或点通知授权）
- 确保 Privy Dashboard 的 Allowed Origins 加过 `http://localhost:5173`，否则会 CSP/origin 失败

**注意**：TG Mini App 的 `window.Telegram.WebApp.initData` 只有在 TG 客户端里打开时才有值，localhost 点不了。所以 Mini App 行为的验证必须走 Pages。

## 三、部署到 GitHub Pages

```bash
git push origin main
```

push 后去仓库 **Actions** 盯一下 `Deploy to GitHub Pages` 跑绿，访问 `https://errancel.github.io/ErranceL-privy-tg-test/`。

首次 deploy 如果 404，检查：

- Settings → Pages → Source 是否设为 `GitHub Actions`
- `VITE_PRIVY_APP_ID` secret 是否存在（否则 build 会 fail-fast 报错）

## 四、验证清单

按顺序跑完，任何失败都能在页面右上角 toast + 中心 `<pre>` 调试面板里看到具体原因。

- [ ] 浏览器访问 `https://errancel.github.io/ErranceL-privy-tg-test/` → 点 **Log in with Telegram** → 走 Login Widget → toast 显示 `登录成功 | method=telegram | user=did:privy:... | token=...`
- [ ] 通过 BotFather 菜单按钮在 TG 客户端内打开同一 URL → 登录 → toast 显示 `wasAlreadyAuthenticated=false`，`<pre>` 里 `telegramEnv.initDataPresent = true`
- [ ] TG 客户端内刷新 webapp → 不需要再点登录 → toast 显示 `检测到已登录，自动恢复`
- [ ] 点 **Log out** → toast `已登出 | localStorage privy:* 清理 N 条` → 再点登录能正常弹，不会卡 "already logged in"
- [ ] 故意把 Privy Dashboard 的 Allowed Origins 删掉 `https://errancel.github.io` → 重试登录 → toast 显示明确的 CSP / origin 错误
- [ ] 故意把 Privy Dashboard 的 bot token 填错 → 重试登录 → toast 显示 `invalid_data` 类错误

## 五、关键实现要点

### 错误归一化

Privy 的 `onError` 回调收到的 err 可能是 string 也可能是 Error 对象。我们在 `src/App.tsx` 里统一 `normalizeError` 成 `{ type, code, msg }`，toast 里三个字段都打出来，同时 `console.error` 原值。

已知错误字符串（从内部另一个 Privy 项目实战记录）：

| 字符串 | 含义 |
| --- | --- |
| `exited_auth_flow` | 用户关了登录窗（widget 模式常见） |
| `invalid_data` | initData 验签失败，**bot token 配错最常见** |
| `user_not_found` | Privy 侧账号问题 |
| `network_error` | 网络 |
| `privy_token_missing` | SDK 内部 token 未就绪就被调用 |

### 会话恢复 toast

Privy cached session 恢复 **不会** 触发 `useLoginWithTelegram.onComplete`。用 `useEffect` 监听 `ready && authenticated` transition，自己弹一条 info toast。

### StrictMode 双触发

React StrictMode 下 `onComplete` 会被调两次。用 `useRef` 做 1 秒锁，避免重复 toast 和重复异步调用。

### 登出 workaround（必须）

Privy dev 环境 `/sessions/logout` 有时 CORS 400 导致内存 `authenticated` 残留，下次 `login()` 报 "already logged in" 但无 UI 反馈。`handleLogout` 里在 `logout()` 之后扫 `localStorage` 删掉所有 `privy:` 前缀 key。页面上另外有一个 `Clear privy:* localStorage` 手动按钮，万一卡死可以点一下。

### fail-fast env

`src/main.tsx` 在 render 之前断言 `VITE_PRIVY_APP_ID` 存在，防止 CI secret 漏配时编出一份空 App ID 的 bundle。

### Vite base 按环境切

`vite.config.ts`：`build` 时 `base='/ErranceL-privy-tg-test/'`（GitHub Pages 要求），`dev` 时 `base='/'`（localhost 直接跑）。

## 六、排错手册（实测填）

验证过程中遇到的实际错误与修复：

| 错误 toast 文本 | 根因 | 修复 |
| --- | --- | --- |
| *(待填)* | | |

## 七、截图（交付物）

- `docs/1-browser-widget.png` 浏览器 widget 登录成功
- `docs/2-tg-miniapp.png` TG 客户端内登录成功
- `docs/3-error.png` 故意配错时的失败 toast

*(还没拍，验证完再放)*
