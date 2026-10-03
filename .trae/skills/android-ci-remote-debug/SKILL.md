---
name: android-ci-remote-debug
description: 本地无 Android 工具链时，通过 GitHub Actions 远程编译 scanner-app 并用 check-run annotations API 定位 Kotlin/AAPT 错误。用于 CI 构建失败、Actions 网页日志需登录无法查看、需要远程确认 APK 产物时。不要用于本地可直接编译的项目。
---

# Android CI 远程编译排错（scanner-app）

本机没有 Java/Gradle，scanner-app 的唯一编译途径是 GitHub Actions（仓库 ddcopy-ljd/app-platform，workflow 在 .github/workflows/scanner-app-build.yml）。
网页版 Actions 日志未登录看不了，但 check-run annotations 是**公开 API**，可以直接读到构建错误。

## 固定循环：注解化 workflow → 推送 → 读注解 → 修复 → 还原

### 1. 临时把构建步骤改成「失败也继续 + 输出错误注解」

用下面内容替换 workflow（关键：gradle 输出重定向到日志、step 不直接失败、grep 错误用 `::error::` 上报、gate step 决定最终成败）：

```yaml
      - name: Build Debug APK
        working-directory: ./scanner-app
        run: |
          set +e
          gradle assembleDebug --no-daemon --stacktrace > build-debug.log 2>&1
          echo "BUILD_EXIT=$?" >> $GITHUB_ENV
          exit 0

      - name: Show build errors
        working-directory: ./scanner-app
        if: ${{ env.BUILD_EXIT != '0' }}
        run: |
          E=$(grep "^e:" build-debug.log | head -30 | cut -c1-220 | tr '\n' '|')
          echo "::error::KOTLIN: $E"
          W=$(grep -A8 "What went wrong" build-debug.log | head -30 | cut -c1-200 | tr '\n' '|')
          echo "::error::WHAT: $W"
          AAPT=$(grep -iE "AAPT|error: |Android resource" build-debug.log | head -20 | cut -c1-200 | tr '\n' '|')
          echo "::error::RES: $AAPT"

      - name: Build gate
        run: |
          if [ "${BUILD_EXIT}" != "0" ]; then echo "Build failed"; exit 1; fi
```

### 2. 推送并等待，读公开 API（PowerShell）

```powershell
# 最新一次 run
$r = Invoke-RestMethod "https://api.github.com/repos/ddcopy-ljd/app-platform/actions/runs?per_page=1" -Headers @{"User-Agent"="x"}
$run = $r.workflow_runs[0]   # 看 status / conclusion / id

# 失败后：jobs → check_run_url → annotations
$j = Invoke-RestMethod "https://api.github.com/repos/ddcopy-ljd/app-platform/actions/runs/$($run.id)/jobs" -Headers @{"User-Agent"="x"}
$a = Invoke-RestMethod "https://api.github.com/repos/ddcopy-ljd/app-platform/check-runs/$($j.jobs[0].id)/annotations" -Headers @{"User-Agent"="x"}
$a | Where-Object annotation_level -eq 'failure' | ForEach-Object { $_.message }
```

也可以直接跑 `scripts/watch-build.ps1`（自动查最新 run，失败则打印全部 failure 注解）。

注解内容经验：
- `KOTLIN:` 段 = Kotlin 编译错误，格式 `e: file:///.../Foo.kt:行:列 原因`
- `RES:` 段 = AAPT 资源错误，通常是 layout 引用了不存在的 `@string/xxx` / `@drawable/xxx`
- `WHAT:` 段 = Gradle 任务级失败原因（processDebugResources / compileDebugKotlin）

### 3. 修复后再推，直到 conclusion=success

成功后**立即把 workflow 还原成简洁版**（debug+release 两个构建 + 两个 upload-artifact，无诊断步骤），不要把临时日志步骤留在主分支。

### 4. 确认 APK 产物

`GET /repos/ddcopy-ljd/app-platform/actions/runs/{id}/artifacts`，应看到 rfid-scanner-debug 与 rfid-scanner-release 两个 zip。

## 推送排错（本机网络）

- PowerShell 5，命令间用 `;` 不能用 `&&`。
- git push 频繁 Connection reset / 连不上 github.com:443 时，读系统代理再给**本地仓库**配置（不要改 --global，沙箱无权限）：
  ```powershell
  (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer
  git config --local http.proxy  http://127.0.0.1:<端口>
  git config --local https.proxy http://127.0.0.1:<端口>
  ```
  Invoke-RestMethod 访问 API 同样加 `-Proxy http://127.0.0.1:<端口>`。代理也不通时，间隔 60-90s 重试即可恢复。

## 提交 Kotlin 前的静态自查（省 CI 往返）

- 全量比对 layout 里的 `@string/`、`@drawable/`、`@style/`、`@color/` 引用是否都在 res 下定义；中文 values 与 values-en 两份 strings.xml 要同步。
- RSCJA DeviceAPI AAR 的历史坑（已踩过，勿回退）：
  - 标签方法是 `UHFTAGInfo.getEPC()`，不是 getEpc()
  - `getRssi()` 平台类型，用 `?.toString()` 后正则取整数
  - AAR 放 app/libs，build.gradle 用 flatDir `rootProject.file('app/libs')`
- Android API 易错：`KeyEvent` 重复按下属性是 `repeatCount`（不是 repeat）；`Activity.attachBaseContext` 里只能用传入的 base Context 读 SharedPreferences，不要碰 applicationContext。
- settings.gradle 必须有 pluginManagement（google/gradlePluginPortal/mavenCentral）。

## 改后端 Python 后

本地可验证，不必走 CI：
```powershell
& ".\.venv\Scripts\python.exe" -m py_compile plugins\jewelry\main.py
```
协同盘点接口的端到端验证起临时服务（PORT=8003，admin/123456），测完删除临时脚本并确认没有遗留 status 为「进行中/待核对」的任务。
