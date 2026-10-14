# dsh-window-bounds

记住 DeepSeek Harness **桌面端**的窗口尺寸和位置，下次启动时窗口回到你上次离开的地方，而不是壳里写死的 1280×820。

中文 | [English](README.en.md)

## 为什么需要插件来做

官方桌面壳（`@deepseek-ai/dsh-desktop`，Electron）在 `lib/main.js` 里把主窗口写死成 `width: 1280, height: 820`，而且没有暴露任何窗口几何相关的 IPC 通道——preload 桥只承载更新、快捷键、内嵌浏览器视图和目录选择器，没有任何读写主窗口 bounds 的能力，也没有对应的 `DSH_DESKTOP_*` 环境变量。

唯一剩下的入口就是窗口本身：`dsh-app://app` 源上的页面可以调用 `window.resizeTo()` / `window.moveTo()`。官方发行版里的 [`dsh-ui-scale`](https://github.com/juliankang4/dsh-ui-scale) 插件正是用这条路径实现它自己的窗口尺寸功能，本插件沿用同一做法。

## 工作原理

1. Host 半边监听 webserver 的 `webserver/index-inject` 事件，推入一行 `{ kind: 'script', placement: 'head' }`。
2. 桌面壳启动时向 Host 取这张注入表（`ctx.webServer.collectIndexInjections()`），并在自己的应用 bundle 挂载**之前**执行它——所以缩放在窗口仍处于隐藏状态时就完成了，不会看到跳变。
3. 注入脚本从 `localStorage` 读取已保存的几何（`dsh-app://app` 源上的 `dsh-window-bounds:v1`），结合当前显示器做校验后应用，随后把 `resize`/`move` 事件防抖写回存储。
4. 保存采用防抖而不是在卸载时执行，因为点击关闭时桌面窗口是**隐藏到托盘**而非退出；常见路径下卸载回调根本不会触发。

被拒绝的几何绝不会把窗口藏起来：尺寸低于下限、坐标超出位置上限、或保存的位置已不在当前显示器工作区内，都会回退到壳的默认值（若只有位置被拒，仍然有效的那部分尺寸会保留）。

## 安装

```sh
dsh plugin --profile <profile> add flying4055/dsh-window-bounds
```

本包声明了 `dsh.bundle.patch`，因此 `dsh plugin add` 会完成安装、把包名追加进 profile 的 `dsh.profile.bundles`、并挂载它的 `cordis.patch.yml`；对应的 `remove` 会全部撤回。装完重启该 profile 生效。

### 桌面端应用

桌面 profile 归 Electron 应用独占，CLI 会拒绝对它操作。请在应用内的插件面板（插件 → 添加插件）安装，输入 `flying4055/dsh-window-bounds`。

### 手动安装

对于没有其他管理方的 profile，把包放进它的 `node_modules`，再在 profile patch 里加一条 insert 条目：

```sh
cp -r dsh-window-bounds "$DSH_HOME/profiles/desktop/node_modules/"   # 或 %USERPROFILE%\.dsh\...
```

```yaml
- insert:
    - id: window-bounds
      name: dsh-window-bounds
```

不需要其他操作：插件默认启用，且自身不加载任何依赖包（桌面 profile 下没有 `@deepseek-ai` 包，而 runtime 的依赖树在 `app.asar` 内部，所以本插件自行校验配置，不引入 schema 库）。本仓库附带 `install.mjs`，可为本地桌面 profile 完成上述复制与 patch 编辑，并支持撤销；它是**本地开发用的旁路**，正常安装请用上面的 `dsh plugin add` 或应用内插件面板，不要两条路同时用。

### GitHub 安装是按提交钉住的

从 GitHub 安装时，pnpm 会把解析结果记为 `codeload.github.com/.../tar.gz/<commit>`，也就是**锁在当时的 main**。仓库之后有新提交，本地不会自动跟：应用面板里的插件开关只启用/停用，不会重新拉取。要更新，重新执行一次同样的 add 即可：

```sh
dsh plugin --profile <profile> add flying4055/dsh-window-bounds
```

这也意味着插件的 `locale/`、`lib/` 等目录必须**在安装时的那个提交里就存在**：宿主读取 `<包名>/locale/en.json` 时若目录缺失，面板会直接报「包元信息错误」，而不是退回英文。`tests/host.spec.js` 与 `package.json` 的 `files`/`exports` 一起守着这条约束。

## 配置

配置写在 profile patch 中该条目的 `config` 下，插件的设置表单也写入同一处：

```yaml
- insert:
    - id: window-bounds
      name: dsh-window-bounds
      config:
        remember: true
        restorePosition: true
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用几何的还原与保存。 |
| `remember` | `true` | 是否把变更后的窗口几何持久化供下次启动使用。设为 `false` 时只还原、不覆盖。 |
| `restorePosition` | `true` | 是否连位置一起还原，而不只是尺寸。 |
| `minWidth` / `minHeight` | `480` / `360` | 可还原的最小尺寸。 |
| `maxPosition` | `8000` | 可还原的 `x` 或 `y` 的绝对像素上限。 |
| `saveDelayMs` | `400` | 持久化变更几何前的防抖延迟。 |
| `trace` | `false` | 把页面实测到的几何追加写入 profile 下的 `window-bounds-trace.log`。 |

字段值非法会让插件加载直接失败并指出出错字段，而不是按一份没人写过的策略运行。

### 为什么插件面板里没有配置表单

**这是刻意的，请不要给 `Config` 加 `toJSON`。** DSH 0.2.0-rc.2 的设置服务用 `Config !== undefined && 'toJSON' in Config` 判断「这个插件的 Config 是否可渲染」，随后把选中的对象**当作 schemastery schema** 使用，直接读取 `schema.meta.volatile` 与 `schema.dict`。于是：

- 一个只是「长得像 schema」的普通对象会通过该判定，然后在 `settings/describe` 中抛出 `TypeError: Cannot read properties of undefined (reading 'volatile')`；
- 这个 Remote 调用整体失败，桌面端欢迎窗口随之报 `desktop welcome: Web RPC failed`，**应用一启动就崩**。

从插件侧也拿不到真正的 schemastery：运行时把依赖收在 `app.asar` 内部，Node 的解析规则从磁盘上的插件找不到 `@deepseek-ai/schemastery`。所以本插件只导出 `~standard`（供 loader 校验 `config`）而**不导出** `toJSON`，面板自然没有字段可渲染，`settings/describe` 会安全跳过它。`tests/host.spec.js` 中有一道断言守着这个不变式。

`configJsonSchema()` 仍导出 JSON Schema 投影，供文档或自行渲染表单的调用方使用，但它**不挂在 `Config` 上**。

### 插件面板里的名称与介绍

面板卡片上的标题和描述来自 **`locale/<语言>.json`**，约定与生态内其他插件一致：

```json
{
  "meta": {
    "title": "桌面窗口尺寸记忆",
    "description": "记住 DeepSeek Harness 桌面端的窗口尺寸与位置……"
  }
}
```

宿主读取 `${包名}/locale/en.json` 来**发现**语言字典，再按当前语言挑选 `title`/`description`，两者都缺失时回退到 `package.json` 的 `name`/`description`（也就是英文的包名与描述）。因此 `en.json` 必须存在，否则中文永远不会被选中——`tests/host.spec.js` 会断言两份字典都存在、都是中文、且都在 `files` 与 `exports` 里，避免这种静默回退。

若要遗忘已保存的几何，把窗口调整一次并等它落盘即可，或在桌面端 DevTools 里删除该键：

```js
localStorage.removeItem('dsh-window-bounds:v1')
```

## 验证

在配置里打开 `trace: true` 后重启。插件会提供 `/window-bounds/trace` 端点供注入脚本回传，profile 下会出现 `window-bounds-trace.log`：

```json
{"phase":"boot","geometry":{"x":632,"y":290,"outerWidth":1296,"outerHeight":828}, ...,
 "detail":{"stored":{"x":303,"y":214,"width":1707,"height":1053},
           "target":{"width":1707,"height":1053,"x":303,"y":214}}}
{"phase":"settled","geometry":{"x":295,"y":214,"outerWidth":1739,"outerHeight":1069}, ...}
```

`boot` 是脚本动手前看到的几何，`settled` 是窗口最终变成的几何。`target` 与 settled 的 `geometry` 相等，说明壳接受了这次缩放；若几何仍是默认值，则说明没有生效。打包版壳没有可打开的控制台时，用这个代替控制台。

不开 trace 时，同样的数字在 DevTools 里一次调用即可拿到：

```js
({ outer: [window.outerWidth, window.outerHeight], at: [window.screenX, window.screenY] })
```

## 测试

```sh
node --test tests/geometry.spec.js tests/host.spec.js
```

`tests/geometry.spec.js` 用**注入脚本自身的**解析逻辑（也就是壳真正执行的那份拷贝）跑与 `src/geometry.js` 相同的用例，使两者不可能漂移。`tests/host.spec.js` 覆盖配置校验、Standard Schema 投影，以及注入行。

## 已知限制

- **仅尺寸与位置。** 最大化和全屏状态不会被还原；`resizeTo` 之后由操作系统报告的壳状态才是权威。
- **单一显示器工作区。** 保存的位置只在仍能放进当前显示器时才还原；位于已断开显示器上的位置会被丢弃，而尺寸保留。
- **壳是最终权威。** 未来的壳版本可能忽略来自渲染进程的缩放，或直接提供一等的几何设置项；本插件存在，是因为当前壳两者都没有。
