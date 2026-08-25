# dsh-version-update

DeepSeek Harness 的「版本与更新」永久插件。

## 功能

在「设置 → 通用设置」新增一行：

- 显示当前安装的 dsh 版本；
- 「检查更新」：对比 npm registry 上 `@deepseek-ai/dsh` 的最新版本；
- 发现新版本后出现「立即更新」：执行
  `npm install -g @deepseek-ai/dsh@<版本> --prefix <安装前缀>`，完成后提示重启 dsh 生效。

中英双语，跟随界面语言与亮/暗主题。

## 安装

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-version-update
# 然后重启 web profile
```

## 结构

- `lib/index.js` — Host 半：`GET /api/version/check`、`POST /api/version/update`。
- `lib/client.js` — Client 半：`settings.general.item` 版本行。
- `cordis.patch.yml` — bundle patch，向组合插入 `version-update` 行。
